"""Message rule registry: every tunable number and word list in the message engine.

Same shape as ``rules.RULES``: rule name to a ``RuleConfig`` holding the rule's
weight, its display label, what it detects, and the parameters it reads.
``message_detection.py`` contains no numbers or phrases of its own. Everything
here is plain data (floats, strings, lists and dicts) so a tuning agent can read
and serialize it the same way as the transaction registry.

Scoring is shared with the transaction engine (``scoring.py``), so the compound
multiplier and the maximum score are the ones in ``rules.py``. Phrases are
matched case-insensitively as whole words; a space matches any run of
whitespace.
"""

from __future__ import annotations

from .rules import RuleConfig

# Scores at or above this are flagged for review.
REVIEW_THRESHOLD = 30

# Names that phishing domains and sender names imitate. Matched against domain
# labels, so very short names (which occur inside ordinary words) are left out.
IMPERSONATED_BRANDS = [
    "paypal",
    "apple",
    "microsoft",
    "amazon",
    "netflix",
    "google",
    "chase",
    "wellsfargo",
    "bankofamerica",
    "citibank",
    "docusign",
    "dropbox",
    "fedex",
    "coinbase",
]

# The weights sum to 125.0, above the 100-point maximum, as in the transaction
# registry: a message tripping every rule saturates rather than landing short.
MESSAGE_RULES: dict[str, RuleConfig] = {
    "urgency": RuleConfig(
        weight=15.0,
        label="Urgent language",
        description="Language that pressures the reader to act quickly, such as deadlines and final warnings.",
        params={
            "phrases": [
                "urgent",
                "urgently",
                "immediately",
                "immediate action",
                "act now",
                "right away",
                "as soon as possible",
                "asap",
                "within 24 hours",
                "within 48 hours",
                "within the hour",
                "by end of day",
                "final notice",
                "final warning",
                "last chance",
                "expires today",
                "time-sensitive",
                "time sensitive",
                "do not delay",
                "don't delay",
                "failure to respond",
                "before it's too late",
            ],
            # severity = min(1.0, base_severity + severity_step * (distinct phrases - 1))
            "base_severity": 0.5,
            "severity_step": 0.25,
        },
    ),
    "sensitive_request": RuleConfig(
        weight=25.0,
        label="Sensitive request",
        description="A request for login credentials, payment or bank details, or gift cards.",
        params={
            # Checked in order; the message's severity is the highest kind found.
            "kinds": [
                {
                    "name": "gift cards",
                    "severity": 1.0,
                    "phrases": [
                        "gift card",
                        "gift cards",
                        "itunes card",
                        "google play card",
                        "google play cards",
                        "steam card",
                        "card codes",
                        "scratch off the back",
                    ],
                },
                {
                    "name": "login credentials",
                    "severity": 0.9,
                    "phrases": [
                        "password",
                        "passcode",
                        "login details",
                        "log in details",
                        "sign-in details",
                        "username and password",
                        "verify your account",
                        "verify your identity",
                        "confirm your identity",
                        "security code",
                        "verification code",
                        "one-time code",
                        "social security number",
                    ],
                },
                {
                    "name": "payment or bank details",
                    "severity": 0.6,
                    "phrases": [
                        "wire transfer",
                        "bank transfer",
                        "bank details",
                        "banking details",
                        "routing number",
                        "account number",
                        "card number",
                        "payment details",
                        "send payment",
                        "make a payment",
                        "bitcoin",
                    ],
                },
            ],
        },
    ),
    "suspicious_link": RuleConfig(
        weight=30.0,
        label="Suspicious link",
        description=(
            "A link whose text names a different address than it opens, a domain imitating a "
            "well-known name, a URL shortener, or a raw IP address."
        ),
        params={
            "severities": {
                "mismatched_text": 1.0,
                "lookalike_domain": 0.9,
                "raw_ip": 0.8,
                "shortener": 0.5,
            },
            "shorteners": [
                "bit.ly",
                "tinyurl.com",
                "t.co",
                "goo.gl",
                "ow.ly",
                "is.gd",
                "buff.ly",
                "rebrand.ly",
                "cutt.ly",
                "shorturl.at",
                "tiny.cc",
                "rb.gy",
            ],
            "brands": IMPERSONATED_BRANDS,
            # Character swaps used to imitate a name, undone before comparing.
            "substitutions": {"0": "o", "1": "l", "3": "e", "5": "s", "rn": "m", "vv": "w"},
            # At most this many findings are described; the severity counts them all.
            "max_details": 3,
        },
    ),
    "sender_anomaly": RuleConfig(
        weight=20.0,
        label="Sender anomaly",
        description=(
            "A reply-to address on a different domain from the sender, or a free email address "
            "whose sender name claims to be an institution."
        ),
        params={
            "severities": {
                "reply_to_mismatch": 0.8,
                "free_mail_institution": 0.7,
            },
            "free_mail_domains": [
                "gmail.com",
                "googlemail.com",
                "yahoo.com",
                "outlook.com",
                "hotmail.com",
                "live.com",
                "aol.com",
                "icloud.com",
                "me.com",
                "proton.me",
                "protonmail.com",
                "gmx.com",
                "mail.com",
                "yandex.com",
                "zoho.com",
            ],
            # Words in a sender name that claim an institutional identity.
            "institutional_words": [
                "bank",
                "support",
                "security",
                "billing",
                "accounts",
                "payroll",
                "helpdesk",
                "help desk",
                "service",
                "services",
                "department",
                "administrator",
                "compliance",
                "fraud prevention",
                *IMPERSONATED_BRANDS,
            ],
        },
    ),
    "scam_structure": RuleConfig(
        weight=35.0,
        label="Known scam pattern",
        description=(
            "The structure of a known scam: an invoice with changed bank details, an executive "
            "asking for an urgent wire, or an account-suspension notice asking the reader to act."
        ),
        params={
            "severity": 1.0,
            # A structure matches when every group has at least one phrase in the message.
            "structures": [
                {
                    "name": "an invoice redirect",
                    "groups": [
                        ["invoice", "invoices", "outstanding payment", "remittance", "amount due"],
                        [
                            "new bank details",
                            "new banking details",
                            "updated bank details",
                            "updated banking details",
                            "changed our bank",
                            "new account details",
                            "new account number",
                            "update your records",
                            "update the payment details",
                        ],
                    ],
                },
                {
                    "name": "an executive wire request",
                    "groups": [
                        ["wire transfer", "wire the", "wire funds", "bank transfer", "transfer the funds"],
                        [
                            "ceo",
                            "cfo",
                            "chief executive",
                            "president",
                            "keep this confidential",
                            "keep this between us",
                            "i'm in a meeting",
                            "i am in a meeting",
                            "don't call",
                            "do not call",
                        ],
                    ],
                },
                {
                    "name": "an account-suspension notice",
                    "groups": [
                        [
                            "suspended",
                            "will be suspended",
                            "has been locked",
                            "has been limited",
                            "has been disabled",
                            "deactivated",
                            "unusual activity",
                            "unusual sign-in activity",
                        ],
                        [
                            "verify your account",
                            "confirm your identity",
                            "verify your identity",
                            "restore access",
                            "reactivate",
                            "click the link",
                            "click here",
                            "log in to",
                            "sign in to",
                        ],
                    ],
                },
            ],
        },
    ),
}
