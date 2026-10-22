"""Deterministic rule-based risk scoring.

Each rule takes the transaction, the user's profile, and the user's prior
transactions, reads its weight and thresholds from the rule registry, and
returns a ``FraudFlag`` or ``None``. No numbers are defined here; see
``rules.py``.

Flag details are complete sentences quoting the actual figures, because the
explanation layer repeats them verbatim. They must never contain snake_case
identifiers or state that a transaction is fraud.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Callable, Iterable, Mapping, Optional

from .generator import haversine_miles
from .models import (
    HIGH_RISK_CATEGORIES,
    Category,
    ExplanationSubject,
    FraudFlag,
    RiskAssessment,
    RiskLevel,
    Transaction,
    UserProfile,
)
from .rules import REVIEW_THRESHOLD, RULES, RuleConfig
from .scoring import assessment_from_flags, compound_multiplier  # noqa: F401 (re-exported)
from .scoring import flag as _flag

Registry = Mapping[str, RuleConfig]
Rule = Callable[[Transaction, UserProfile, list[Transaction], Registry], Optional[FraudFlag]]


def _money(amount: float) -> str:
    return f"${amount:,.2f}"


def category_label(category: Category) -> str:
    """Human label for a category. Category values are snake_case and are never
    shown to users."""
    return category.value.replace("_", " ").capitalize()


def _z_score(txn: Transaction, profile: UserProfile) -> Optional[float]:
    if profile.std_amount <= 0:
        return None
    return (txn.amount - profile.avg_amount) / profile.std_amount


# --- Explanation subject -------------------------------------------------------

TRANSACTION_ACTIONS: dict[RiskLevel, str] = {
    RiskLevel.LOW: "No action is needed; this transaction can proceed normally.",
    RiskLevel.MEDIUM: "Keep watching this account for further unusual activity.",
    RiskLevel.HIGH: "Hold this transaction for manual review before it is approved.",
    RiskLevel.CRITICAL: (
        "Hold this transaction and contact the cardholder to confirm it before it settles."
    ),
}


def transaction_subject(txn: Transaction, review_threshold: float = REVIEW_THRESHOLD) -> ExplanationSubject:
    """How the explainer describes a transaction. Deliberately excludes
    ``is_fraud``: it is evaluation ground truth and never reaches the model."""
    return ExplanationSubject(
        noun="transaction",
        facts=[
            ("Amount", _money(txn.amount)),
            ("Merchant", txn.merchant),
            ("Category", category_label(txn.category)),
            ("Location", f"{txn.city}, {txn.state}"),
            ("Date and time", f"{txn.timestamp:%A %d %B %Y at %H:%M}"),
        ],
        summary=f"This transaction of {_money(txn.amount)} at {txn.merchant}",
        review_threshold=review_threshold,
        actions=TRANSACTION_ACTIONS,
    )


# --- Rules ---------------------------------------------------------------------


def rule_amount_anomaly(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["amount_anomaly"]
    p = cfg.params
    z = _z_score(txn, profile)
    if z is None or z < p["z_threshold"]:
        return None
    severity = min(1.0, (z - p["z_threshold"]) / p["severity_ramp"] + p["base_severity"])
    return _flag(
        "amount_anomaly",
        cfg,
        severity,
        f"The amount of {_money(txn.amount)} is {z:.2f} standard deviations above this customer's "
        f"average of {_money(profile.avg_amount)} (standard deviation {_money(profile.std_amount)}), "
        f"at or above the threshold of {p['z_threshold']:g}.",
    )


def rule_micro_amount(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    # Card-testing signal. Requires both a small absolute amount and a small amount
    # relative to this user; either condition alone produces false positives.
    cfg = rules["micro_amount"]
    p = cfg.params
    z = _z_score(txn, profile)
    if z is None or not (txn.amount < p["ceiling"] and z <= p["max_z"]):
        return None
    return _flag(
        "micro_amount",
        cfg,
        p["severity"],
        f"The amount of {_money(txn.amount)} is below {_money(p['ceiling'])} and {abs(z):.2f} standard "
        f"deviations below this customer's average of {_money(profile.avg_amount)}, which is consistent "
        f"with card-testing patterns.",
    )


def rule_velocity(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["velocity"]
    p = cfg.params
    window_start = txn.timestamp - timedelta(minutes=p["window_minutes"])
    count = sum(1 for t in prior if t.timestamp >= window_start)
    if count < p["threshold"]:
        return None
    severity = min(1.0, p["base_severity"] + p["severity_step"] * (count - p["threshold"]))
    noun = "transaction" if count == 1 else "transactions"
    return _flag(
        "velocity",
        cfg,
        severity,
        f"{count} earlier {noun} occurred within the {p['window_minutes']:g} minutes before this one, "
        f"at or above the threshold of {p['threshold']:g}.",
    )


def rule_unusual_hour(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["unusual_hour"]
    p = cfg.params
    hour = txn.timestamp.hour
    start, end = profile.active_hour_start, profile.active_hour_end
    in_window = start <= hour <= end if start <= end else (hour >= start or hour <= end)
    if in_window:
        return None
    late_night = p["late_night_start"] <= hour <= p["late_night_end"]
    severity = p["late_night_severity"] if late_night else p["base_severity"]
    detail = (
        f"The transaction occurred at {txn.timestamp:%H:%M}, outside this customer's usual activity "
        f"window of {start:02d}:00 to {end:02d}:59."
    )
    if late_night:
        detail += (
            f" Activity between {p['late_night_start']:02d}:00 and {p['late_night_end']:02d}:59 "
            f"carries added severity."
        )
    return _flag("unusual_hour", cfg, severity, detail)


def rule_category_mismatch(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["category_mismatch"]
    p = cfg.params
    if txn.category in profile.typical_categories:
        return None
    high_risk = txn.category in HIGH_RISK_CATEGORIES
    usual = ", ".join(category_label(c) for c in profile.typical_categories)
    detail = (
        f"The category {category_label(txn.category)} is not among this customer's usual categories "
        f"({usual})."
    )
    if high_risk:
        detail += f" {category_label(txn.category)} is a high-risk category."
    return _flag(
        "category_mismatch",
        cfg,
        p["high_risk_severity"] if high_risk else p["standard_severity"],
        detail,
    )


def rule_geographic_anomaly(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["geographic_anomaly"]
    p = cfg.params
    distance = haversine_miles(profile.home_latitude, profile.home_longitude, txn.latitude, txn.longitude)
    if distance < p["min_distance_miles"]:
        return None
    detail = (
        f"This transaction in {txn.city}, {txn.state} is {distance:,.0f} miles from the customer's home "
        f"in {profile.home_city}, {profile.home_state}."
    )

    # Fastest implied travel from any prior transaction inside the lookback window.
    lookback_start = txn.timestamp - timedelta(hours=p["travel_lookback_hours"])
    fastest: Optional[tuple[float, float, float, Transaction]] = None
    for t in prior:
        if t.timestamp < lookback_start:
            continue
        hours = (txn.timestamp - t.timestamp).total_seconds() / 3600
        leg = haversine_miles(t.latitude, t.longitude, txn.latitude, txn.longitude)
        mph = leg / hours if hours > 0 else float("inf")
        if fastest is None or mph > fastest[0]:
            fastest = (mph, leg, hours, t)

    if fastest is not None and fastest[0] > p["max_travel_mph"]:
        mph, leg, hours, t = fastest
        return _flag(
            "geographic_anomaly",
            cfg,
            p["impossible_travel_severity"],
            detail
            + f" A transaction in {t.city}, {t.state} {hours:.2f} hours earlier is {leg:,.0f} miles away, "
            f"implying travel at {mph:,.0f} mph, above the maximum plausible speed of "
            f"{p['max_travel_mph']:,.0f} mph.",
        )

    severity = min(
        p["distance_severity_cap"],
        p["base_severity"] + (distance - p["min_distance_miles"]) / p["distance_ramp_miles"],
    )
    return _flag("geographic_anomaly", cfg, severity, detail)


def rule_round_amount(
    txn: Transaction, profile: UserProfile, prior: list[Transaction], rules: Registry = RULES
) -> Optional[FraudFlag]:
    cfg = rules["round_amount"]
    p = cfg.params
    if txn.amount < p["min_amount"] or not txn.amount.is_integer():
        return None
    dollars = int(txn.amount)
    for multiple, severity in p["tiers"]:
        if dollars % multiple == 0:
            return _flag(
                "round_amount",
                cfg,
                severity,
                f"The amount of {_money(txn.amount)} is an exact multiple of {_money(multiple)}.",
            )
    return None


RULE_FUNCTIONS: dict[str, Rule] = {
    "amount_anomaly": rule_amount_anomaly,
    "micro_amount": rule_micro_amount,
    "velocity": rule_velocity,
    "unusual_hour": rule_unusual_hour,
    "category_mismatch": rule_category_mismatch,
    "geographic_anomaly": rule_geographic_anomaly,
    "round_amount": rule_round_amount,
}


# --- Scoring -------------------------------------------------------------------


def assess(
    txn: Transaction,
    profile: UserProfile,
    recent: Iterable[Transaction],
    rules: Registry = RULES,
) -> RiskAssessment:
    """Score one transaction.

    Only the user's transactions strictly before ``txn`` are considered, so
    passing a full history (including ``txn`` itself or later ones) is safe.
    """
    prior = sorted(
        (t for t in recent if t.user_id == txn.user_id and t.timestamp < txn.timestamp),
        key=lambda t: (t.timestamp, t.transaction_id),
    )
    flags = [
        flag
        for name, rule in RULE_FUNCTIONS.items()
        if name in rules and (flag := rule(txn, profile, prior, rules)) is not None
    ]
    return assessment_from_flags(txn.transaction_id, flags)


def assess_all(
    transactions: Iterable[Transaction],
    profiles: Iterable[UserProfile],
    rules: Registry = RULES,
) -> list[RiskAssessment]:
    """Score a transaction history, giving each transaction only its own past.

    Transactions are processed in chronological order. Results are returned in
    the same order as ``transactions``.
    """
    txns = list(transactions)
    by_user = {p.user_id: p for p in profiles}
    order = sorted(range(len(txns)), key=lambda i: (txns[i].timestamp, txns[i].transaction_id))

    history: dict[str, list[Transaction]] = {}
    results: list[Optional[RiskAssessment]] = [None] * len(txns)
    for i in order:
        txn = txns[i]
        past = history.setdefault(txn.user_id, [])
        results[i] = assess(txn, by_user[txn.user_id], past, rules)
        past.append(txn)
    return results  # type: ignore[return-value]
