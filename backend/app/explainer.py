"""Plain-English explanations of an already-computed risk assessment.

The model receives the transaction, the risk score, and only the indicators that
actually fired, and is instructed to explain those and nothing else. It never
produces or changes a score, adds or removes an indicator, picks a risk level,
or decides an outcome — ``detection.assess`` has done all of that before this
module is called.

``_fallback`` builds the same shape of explanation deterministically from the
flag details, so the system keeps explaining itself when no API key is
configured or the call fails.
"""

from __future__ import annotations

import logging
import os
import re
from typing import TYPE_CHECKING, Literal, Mapping, Optional

from pydantic import BaseModel

from .detection import category_label
from .models import RiskAssessment, RiskLevel, Transaction
from .rules import REVIEW_THRESHOLD, RULES, RuleConfig

try:  # The SDK is optional at runtime: detection and the fallback never need it.
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None  # type: ignore[assignment]

if TYPE_CHECKING:
    from anthropic import Anthropic

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 300

Registry = Mapping[str, RuleConfig]


SYSTEM_PROMPT = """\
You write short, plain-English explanations of transaction risk assessments for \
a fraud operations dashboard.

A deterministic rules engine has already scored the transaction and selected the \
indicators below. You do not assess risk: you never produce or change a score, \
never decide an outcome, and never judge whether the indicators are correct. You \
put the assessment you are given into language a non-technical reader \
understands.

Follow every rule:
- Explain only the indicators listed in the message. Never mention, invent, imply \
or hint at an indicator that is not listed, however likely it seems.
- Never state or imply that the transaction is fraud, fraudulent, theft or a \
crime, and never call the customer a fraudster. Describe what the assessment \
says: high risk, flagged for review, consistent with card-testing patterns.
- Write for a non-technical reader. No jargon, no field names, no identifiers, no \
formulas, no mention of rules, weights or severities.
- Two or three sentences for the explanation, then exactly one recommended action.

Reply in exactly this format, with nothing before or after it:

EXPLANATION: <two or three sentences>
ACTION: <one sentence, on its own line>"""


_LEVEL_ACTIONS: dict[RiskLevel, str] = {
    RiskLevel.LOW: "No action is needed; this transaction can proceed normally.",
    RiskLevel.MEDIUM: "Keep watching this account for further unusual activity.",
    RiskLevel.HIGH: "Hold this transaction for manual review before it is approved.",
    RiskLevel.CRITICAL: (
        "Hold this transaction and contact the cardholder to confirm it before it settles."
    ),
}


# no_indicators: nothing fired, so the model is not asked. no_api_key: no key is
# configured. model_unavailable: the SDK is missing, the call failed, or the reply
# did not parse.
FallbackReason = Literal["no_indicators", "no_api_key", "model_unavailable"]


class Explanation(BaseModel):
    transaction_id: str
    explanation: str
    action: str
    # Whether the text came from the model or from the deterministic fallback.
    source: Literal["model", "fallback"]
    # Why the fallback was used; ``None`` when ``source`` is "model".
    fallback_reason: Optional[FallbackReason] = None


def indicator_label(rule: str, rules: Registry = RULES) -> str:
    """Human label for a rule key. Rule keys are snake_case and never shown to users."""
    cfg = rules.get(rule)
    if cfg is not None:
        return cfg.label
    return rule.replace("_", " ").capitalize()


def _money(amount: float) -> str:
    return f"${amount:,.2f}"


_CLIENT: Optional["Anthropic"] = None


def _client() -> Optional["Anthropic"]:
    """The shared client, or ``None`` when the SDK or the API key is missing."""
    global _CLIENT
    if anthropic is None or not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    if _CLIENT is None:
        _CLIENT = anthropic.Anthropic()
    return _CLIENT


def _prompt(txn: Transaction, assessment: RiskAssessment, rules: Registry) -> str:
    """The user message. Deliberately excludes ``is_fraud``: it is evaluation
    ground truth and is never surfaced to users or to the model."""
    lines = [
        "Transaction under review:",
        f"- Amount: {_money(txn.amount)}",
        f"- Merchant: {txn.merchant}",
        f"- Category: {category_label(txn.category)}",
        f"- Location: {txn.city}, {txn.state}",
        f"- Date and time: {txn.timestamp:%A %d %B %Y at %H:%M}",
        "",
        f"Risk score: {assessment.risk_score:.1f} out of 100, which is "
        f"{assessment.risk_level.value} risk.",
        (
            "This score is at or above the review threshold, so the transaction is "
            "flagged for review."
            if assessment.risk_score >= REVIEW_THRESHOLD
            else "This score is below the review threshold."
        ),
        "",
        "Indicators that fired. These are the only ones you may mention:",
    ]
    lines += [
        f"- {indicator_label(flag.rule, rules)}: {flag.detail}" for flag in assessment.flags
    ]
    return "\n".join(lines)


_EXPLANATION_RE = re.compile(r"EXPLANATION:\s*(.+?)(?=\n\s*ACTION:|\Z)", re.IGNORECASE | re.DOTALL)
_ACTION_RE = re.compile(r"ACTION:\s*(.+)", re.IGNORECASE | re.DOTALL)


def _parse(text: str) -> Optional[tuple[str, str]]:
    explanation = _EXPLANATION_RE.search(text)
    action = _ACTION_RE.search(text)
    if explanation is None or action is None:
        return None
    body = " ".join(explanation.group(1).split())
    step = " ".join(action.group(1).split())
    if not body or not step:
        return None
    return body, step


def _fallback(
    txn: Transaction,
    assessment: RiskAssessment,
    rules: Registry = RULES,
    reason: FallbackReason = "model_unavailable",
) -> Explanation:
    """Deterministic explanation assembled from the flag details.

    Flag details are already complete sentences, so they are used verbatim: their
    original casing is preserved because several of them open with a city name.
    """
    opening = (
        f"This transaction of {_money(txn.amount)} at {txn.merchant} scored "
        f"{assessment.risk_score:.1f} out of 100, which is {assessment.risk_level.value} risk."
    )
    if assessment.risk_score >= REVIEW_THRESHOLD:
        opening += " It is flagged for review."

    if not assessment.flags:
        return Explanation(
            transaction_id=assessment.transaction_id,
            explanation=f"{opening} None of the detection indicators were triggered.",
            action=_LEVEL_ACTIONS[assessment.risk_level],
            source="fallback",
            fallback_reason=reason,
        )

    labels = ", ".join(indicator_label(flag.rule, rules) for flag in assessment.flags)
    count = len(assessment.flags)
    noun = "indicator was" if count == 1 else "indicators were"
    details = " ".join(flag.detail for flag in assessment.flags)
    return Explanation(
        transaction_id=assessment.transaction_id,
        explanation=f"{opening} {count} {noun} triggered ({labels}). {details}",
        action=_LEVEL_ACTIONS[assessment.risk_level],
        source="fallback",
        fallback_reason=reason,
    )


def explain(
    txn: Transaction, assessment: RiskAssessment, rules: Registry = RULES
) -> Explanation:
    """Turn a computed assessment into reader-facing language.

    Falls back to a deterministic explanation when the SDK or API key is missing,
    when the call raises, or when the reply does not parse.
    """
    # With no indicators there is nothing for the model to explain, and asking it
    # to anyway invites it to invent one.
    if not assessment.flags:
        return _fallback(txn, assessment, rules, "no_indicators")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        return _fallback(txn, assessment, rules, "no_api_key")
    client = _client()
    if client is None:
        return _fallback(txn, assessment, rules, "model_unavailable")

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _prompt(txn, assessment, rules)}],
        )
        text = "".join(block.text for block in response.content if block.type == "text")
    except Exception:  # The explanation is never load-bearing; detection has already run.
        logger.warning("Explanation call failed for %s; using fallback", assessment.transaction_id, exc_info=True)
        return _fallback(txn, assessment, rules)

    parsed = _parse(text)
    if parsed is None:
        logger.warning("Unparseable explanation for %s; using fallback", assessment.transaction_id)
        return _fallback(txn, assessment, rules)

    body, step = parsed
    return Explanation(
        transaction_id=assessment.transaction_id,
        explanation=body,
        action=step,
        source="model",
    )
