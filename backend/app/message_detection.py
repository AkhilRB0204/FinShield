"""Deterministic rule-based risk scoring for messages.

Each rule takes the raw message text and the message rule registry, reads its
weight, phrases and thresholds from the registry, and returns a ``FraudFlag``
or ``None``. No numbers or phrases are defined here; see ``message_rules.py``.
Flags become a score in ``scoring.py``, exactly as transaction flags do.

Flag details are complete sentences quoting the phrase, address or domain that
triggered them, because the explanation layer repeats them verbatim. They must
never contain snake_case identifiers or state that a message is fraud.

The text is treated as data throughout: it is parsed with regular expressions,
never rendered or followed, and no link in it is fetched.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from email.utils import parseaddr
from functools import lru_cache
from typing import Callable, Mapping, Optional
from urllib.parse import urlsplit

from .message_rules import MESSAGE_RULES, REVIEW_THRESHOLD
from .models import ExplanationSubject, FraudFlag, RiskAssessment, RiskLevel
from .rules import RuleConfig
from .scoring import assessment_from_flags
from .scoring import flag as _flag

Registry = Mapping[str, RuleConfig]
Rule = Callable[[str, Registry], Optional[FraudFlag]]


# --- Parsing ---------------------------------------------------------------------


@dataclass(frozen=True)
class Link:
    url: str
    host: str
    # The visible text of an HTML or Markdown link; None for a bare URL.
    text: Optional[str] = None


@dataclass(frozen=True)
class ParsedMessage:
    sender_name: str
    sender_address: str
    reply_to: str
    subject: str
    body: str
    links: tuple[Link, ...]

    @property
    def content(self) -> str:
        """What phrase rules read: the subject line and the body."""
        return f"{self.subject}\n{self.body}" if self.subject else self.body


_HEADER_RE = re.compile(r"^([A-Za-z][A-Za-z-]*):[ \t]*(.*)$")
_ANCHOR_RE = re.compile(r"""<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", re.IGNORECASE | re.DOTALL)
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
_BARE_URL_RE = re.compile(r"""(?:https?://|www\.)[^\s<>"'()\[\]]+""", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
# Link text that reads as an address: "www.paypal.com", "https://paypal.com/login".
_ADDRESS_TEXT_RE = re.compile(r"^\s*(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?\s*$", re.IGNORECASE)
_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _host(url: str) -> str:
    target = url if re.match(r"^[a-z][a-z0-9+.-]*://", url, re.IGNORECASE) else f"http://{url}"
    try:
        return (urlsplit(target).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def _links(text: str) -> tuple[Link, ...]:
    links: list[Link] = []
    seen: set[tuple[str, Optional[str]]] = set()

    def add(url: str, label: Optional[str]) -> None:
        url = url.strip().rstrip(".,;:!?")
        host = _host(url)
        if host and (url, label) not in seen:
            seen.add((url, label))
            links.append(Link(url=url, host=host, text=label))

    covered: list[tuple[int, int]] = []
    for match in _ANCHOR_RE.finditer(text):
        add(match.group(1), " ".join(_TAG_RE.sub("", match.group(2)).split()) or None)
        covered.append(match.span())
    for match in _MARKDOWN_LINK_RE.finditer(text):
        add(match.group(2), match.group(1).strip() or None)
        covered.append(match.span())
    for match in _BARE_URL_RE.finditer(text):
        if not any(start <= match.start() < end for start, end in covered):
            add(match.group(0), None)
    return tuple(links)


@lru_cache(maxsize=64)
def parse_message(text: str) -> ParsedMessage:
    """Split leading email-style headers (From, Reply-To, Subject) from the body.

    Headers are optional: text that does not open with a header line is all body.
    """
    headers: dict[str, str] = {}
    lines = text.strip("\n").splitlines()
    i = 0
    while i < len(lines):
        match = _HEADER_RE.match(lines[i])
        if not match:
            break
        headers[match.group(1).lower()] = match.group(2).strip()
        i += 1
    if headers and i < len(lines) and lines[i].strip() == "":
        i += 1
    body = "\n".join(lines[i:]) if headers else text

    sender_name, sender_address = parseaddr(headers.get("from", ""))
    _, reply_to = parseaddr(headers.get("reply-to", ""))
    return ParsedMessage(
        sender_name=sender_name.strip(),
        sender_address=sender_address.strip().lower(),
        reply_to=reply_to.strip().lower(),
        subject=headers.get("subject", ""),
        body=body,
        links=_links(text),
    )


# --- Matching helpers ------------------------------------------------------------


@lru_cache(maxsize=1024)
def _phrase_re(phrase: str) -> re.Pattern[str]:
    words = [re.escape(word) for word in phrase.split()]
    return re.compile(r"(?<!\w)" + r"\s+".join(words) + r"(?!\w)", re.IGNORECASE)


def _find(text: str, phrases: list[str]) -> list[str]:
    """The phrases present in ``text``, as they appear there, in order of first
    appearance and without repeats. Phrases contained in a longer match are dropped."""
    hits: list[tuple[int, int, str]] = []
    for phrase in phrases:
        for match in _phrase_re(phrase).finditer(text):
            hits.append((match.start(), match.end(), match.group(0)))
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    found: list[str] = []
    seen: set[str] = set()
    end = -1
    for start, stop, quoted in hits:
        if start < end:
            continue  # Inside a longer phrase already found.
        end = stop
        key = " ".join(quoted.lower().split())
        if key not in seen:
            seen.add(key)
            found.append(" ".join(quoted.split()))
    return found


def _quote_list(items: list[str]) -> str:
    quoted = [f'"{item}"' for item in items]
    if len(quoted) <= 2:
        return " and ".join(quoted)
    return ", ".join(quoted[:-1]) + f" and {quoted[-1]}"


def _domain(address: str) -> str:
    return address.rpartition("@")[2]


def _registrable(host: str) -> str:
    """Approximate registrable domain: the last two labels, or three under a
    two-letter country code with a generic second level ("example.co.uk")."""
    labels = host.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in ("co", "com", "org", "net", "gov", "ac"):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _same_site(a: str, b: str) -> bool:
    return _registrable(a) == _registrable(b)


def _normalize(label: str, substitutions: Mapping[str, str]) -> str:
    label = label.lower()
    for imitation, letter in substitutions.items():
        label = label.replace(imitation, letter)
    return label


def _imitated_brand(host: str, p: Mapping) -> Optional[str]:
    """The brand ``host`` imitates, if any. A brand's own domain imitates nothing.

    A brand counts when it is a whole hyphen-separated part of the site name
    ("paypa1-secure.com") or a whole subdomain label ("paypal.com.verify.net"),
    after undoing character swaps. Names that merely start with a brand
    ("microsoftonline.com", "amazonaws.com") are left alone.
    """
    registrable = _registrable(host)
    site = registrable.split(".")[0]
    if site in p["brands"]:
        return None
    subdomains = host[: -len(registrable)].rstrip(".").split(".") if host != registrable else []
    candidates = [*re.split(r"[-_]", site), *subdomains]
    normalized = {_normalize(label, p["substitutions"]) for label in candidates if label}
    for brand in p["brands"]:
        if brand in normalized:
            return brand
    return None


# --- Rules -----------------------------------------------------------------------


def rule_urgency(text: str, rules: Registry = MESSAGE_RULES) -> Optional[FraudFlag]:
    cfg = rules["urgency"]
    p = cfg.params
    found = _find(parse_message(text).content, p["phrases"])
    if not found:
        return None
    severity = p["base_severity"] + p["severity_step"] * (len(found) - 1)
    return _flag(
        "urgency",
        cfg,
        severity,
        f"The message uses urgent, time-pressure language: {_quote_list(found)}.",
    )


def rule_sensitive_request(text: str, rules: Registry = MESSAGE_RULES) -> Optional[FraudFlag]:
    cfg = rules["sensitive_request"]
    content = parse_message(text).content
    matched = [(kind, found) for kind in cfg.params["kinds"] if (found := _find(content, kind["phrases"]))]
    if not matched:
        return None
    severity = max(kind["severity"] for kind, _ in matched)
    parts = [f"{kind['name']} ({_quote_list(found)})" for kind, found in matched]
    asks = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + f" and {parts[-1]}"
    return _flag("sensitive_request", cfg, severity, f"The message mentions {asks}.")


def rule_suspicious_link(text: str, rules: Registry = MESSAGE_RULES) -> Optional[FraudFlag]:
    cfg = rules["suspicious_link"]
    p = cfg.params
    severities = p["severities"]
    shorteners = {s.lower() for s in p["shorteners"]}

    findings: list[tuple[float, str]] = []
    for link in parse_message(text).links:
        if link.text:
            shown = _ADDRESS_TEXT_RE.match(link.text)
            if shown and not _same_site(shown.group(1).lower(), link.host):
                findings.append((
                    severities["mismatched_text"],
                    f'The link text "{link.text}" names a different address from the one it opens, "{link.host}".',
                ))
                continue
        if _IPV4_RE.match(link.host):
            findings.append((
                severities["raw_ip"],
                f'The link "{link.url}" points to a raw IP address, "{link.host}", rather than a named website.',
            ))
        elif link.host in shorteners or _registrable(link.host) in shorteners:
            findings.append((
                severities["shortener"],
                f'The link "{link.url}" uses the URL shortener "{link.host}", which hides where it leads.',
            ))
        elif (brand := _imitated_brand(link.host, p)) is not None:
            findings.append((
                severities["lookalike_domain"],
                f'The link domain "{link.host}" imitates the name "{brand}" but is not its website.',
            ))

    if not findings:
        return None
    findings.sort(key=lambda f: f[0], reverse=True)  # Stable: equal severities keep message order.
    detail = " ".join(sentence for _, sentence in findings[: p["max_details"]])
    return _flag("suspicious_link", cfg, findings[0][0], detail)


def rule_sender_anomaly(text: str, rules: Registry = MESSAGE_RULES) -> Optional[FraudFlag]:
    cfg = rules["sender_anomaly"]
    p = cfg.params
    message = parse_message(text)
    sender = message.sender_address
    if not sender:
        return None

    findings: list[tuple[float, str]] = []
    if message.reply_to and not _same_site(_domain(message.reply_to), _domain(sender)):
        findings.append((
            p["severities"]["reply_to_mismatch"],
            f'Replies go to "{message.reply_to}", on a different domain from the sender address "{sender}".',
        ))
    free_mail = {d.lower() for d in p["free_mail_domains"]}
    claimed = _find(message.sender_name, p["institutional_words"]) if message.sender_name else []
    if _domain(sender) in free_mail and claimed:
        findings.append((
            p["severities"]["free_mail_institution"],
            f'The sender name "{message.sender_name}" claims an institutional identity '
            f'({_quote_list(claimed)}), but the address "{sender}" is on the free email service '
            f'"{_domain(sender)}".',
        ))

    if not findings:
        return None
    return _flag(
        "sender_anomaly",
        cfg,
        max(severity for severity, _ in findings),
        " ".join(sentence for _, sentence in findings),
    )


def rule_scam_structure(text: str, rules: Registry = MESSAGE_RULES) -> Optional[FraudFlag]:
    cfg = rules["scam_structure"]
    content = parse_message(text).content
    sentences = []
    for structure in cfg.params["structures"]:
        evidence = [_find(content, group) for group in structure["groups"]]
        if all(evidence):
            quoted = _quote_list([found[0] for found in evidence])
            sentences.append(f"The message follows the pattern of {structure['name']}, combining {quoted}.")
    if not sentences:
        return None
    return _flag("scam_structure", cfg, cfg.params["severity"], " ".join(sentences))


RULE_FUNCTIONS: dict[str, Rule] = {
    "urgency": rule_urgency,
    "sensitive_request": rule_sensitive_request,
    "suspicious_link": rule_suspicious_link,
    "sender_anomaly": rule_sender_anomaly,
    "scam_structure": rule_scam_structure,
}


# --- Scoring ---------------------------------------------------------------------


def message_id(text: str) -> str:
    """A stable id for a message: the same text always gets the same id."""
    return "msg_" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def assess_message(text: str, rules: Registry = MESSAGE_RULES) -> RiskAssessment:
    """Score one message. Deterministic: the same text always scores the same."""
    flags = [
        flag
        for name, rule in RULE_FUNCTIONS.items()
        if name in rules and (flag := rule(text, rules)) is not None
    ]
    return assessment_from_flags(message_id(text), flags)


# --- Explanation subject ---------------------------------------------------------

MESSAGE_ACTIONS: dict[RiskLevel, str] = {
    RiskLevel.LOW: "No action is needed; nothing in this message calls for extra caution.",
    RiskLevel.MEDIUM: "Treat this message with caution and confirm any request it makes through a channel you already trust.",
    RiskLevel.HIGH: "Do not act on this message until its sender is confirmed through a channel you already trust.",
    RiskLevel.CRITICAL: "Do not click its links, reply or send anything; report this message to your security team.",
}


def message_subject(text: str, review_threshold: float = REVIEW_THRESHOLD) -> ExplanationSubject:
    """How the explainer describes a message: its sender and subject line when it
    has them. The body is not passed; the flag details quote what matters."""
    message = parse_message(text)
    facts = []
    if message.sender_address:
        facts.append(("Sender", message.sender_address))
    if message.subject:
        facts.append(("Subject line", message.subject))
    return ExplanationSubject(
        noun="message",
        facts=facts,
        summary=f"This message from {message.sender_address}" if message.sender_address else "This message",
        review_threshold=review_threshold,
        actions=MESSAGE_ACTIONS,
    )
