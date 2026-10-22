"""How flags become a score. Shared by every detection engine.

An engine decides which flags fire (``detection`` for transactions,
``message_detection`` for messages); this module turns them into a
``RiskAssessment`` the same way for all of them: points summed, a compound
multiplier when several indicators fire together, clamped to ``MAX_SCORE``.
The numbers live in ``rules.py``.
"""

from __future__ import annotations

from typing import Iterable

from .models import FraudFlag, RiskAssessment
from .rules import COMPOUND_BONUS_PER_FLAG, COMPOUND_MAX_MULTIPLIER, COMPOUND_MIN_FLAGS, MAX_SCORE, RuleConfig


def flag(name: str, cfg: RuleConfig, severity: float, detail: str) -> FraudFlag:
    """A flag for rule ``name``, carrying its registry weight. Severity is clamped to 0..1."""
    return FraudFlag(rule=name, severity=min(1.0, max(0.0, severity)), weight=cfg.weight, detail=detail)


def compound_multiplier(flag_count: int) -> float:
    if flag_count < COMPOUND_MIN_FLAGS:
        return 1.0
    bonus = COMPOUND_BONUS_PER_FLAG * (flag_count - COMPOUND_MIN_FLAGS + 1)
    return min(COMPOUND_MAX_MULTIPLIER, 1.0 + bonus)


def assessment_from_flags(subject_id: str, flags: Iterable[FraudFlag]) -> RiskAssessment:
    """Score a set of flags. ``flags`` should be in registry order: the result
    lists them most points first, and ties keep that order."""
    ranked = sorted(flags, key=lambda f: f.points, reverse=True)
    raw = sum(f.points for f in ranked)
    score = min(MAX_SCORE, raw * compound_multiplier(len(ranked)))
    return RiskAssessment(
        transaction_id=subject_id,
        risk_score=score,
        risk_level=RiskAssessment.level_for(score),
        flags=ranked,
    )
