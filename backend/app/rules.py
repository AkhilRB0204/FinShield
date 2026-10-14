"""Rule registry: every tunable number in the detection engine lives here.

``RULES`` maps rule name to a ``RuleConfig`` holding the rule's weight and the
thresholds it reads. Detection logic in ``detection.py`` contains no numbers of
its own. The registry is plain data (dataclasses of floats, ints, strings and
lists) so a tuning agent can inspect it, serialize it with
``dataclasses.asdict``, and propose changes against it.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace
from typing import Any, Mapping


@dataclass
class RuleConfig:
    weight: float
    # Human-readable name for display. Rule keys are snake_case and must never be shown to users.
    label: str
    params: dict[str, Any] = field(default_factory=dict)


# --- Scoring -------------------------------------------------------------------

# Scores at or above this are flagged for review.
REVIEW_THRESHOLD = 30

# When COMPOUND_MIN_FLAGS or more rules fire, the summed points are multiplied by
# 1 + COMPOUND_BONUS_PER_FLAG for each flag from the COMPOUND_MIN_FLAGS-th onward,
# capped at COMPOUND_MAX_MULTIPLIER (3 flags -> 1.08, 4 -> 1.16, 5 -> 1.24, 6+ -> 1.30).
COMPOUND_BONUS_PER_FLAG = 0.08
COMPOUND_MIN_FLAGS = 3
COMPOUND_MAX_MULTIPLIER = 1.30

MAX_SCORE = 100.0

# --- Rule thresholds -------------------------------------------------------------

VELOCITY_WINDOW_MINUTES = 30
VELOCITY_THRESHOLD = 2
MAX_TRAVEL_MPH = 500.0
MICRO_AMOUNT_CEILING = 12.0

# --- Registry --------------------------------------------------------------------

# The weights deliberately sum above 100 (160.0 in total). A transaction tripping
# every rule saturates and is clamped to MAX_SCORE rather than landing at some
# arbitrary point below it.
RULES: dict[str, RuleConfig] = {
    "amount_anomaly": RuleConfig(
        weight=30.0,
        label="Amount anomaly",
        params={
            "z_threshold": 3.0,
            # severity = min(1.0, (z - z_threshold) / severity_ramp + base_severity)
            "severity_ramp": 9.0,
            "base_severity": 0.35,
        },
    ),
    "micro_amount": RuleConfig(
        weight=22.0,
        label="Micro amount",
        params={
            # Both conditions are required; either alone produces false positives.
            "ceiling": MICRO_AMOUNT_CEILING,
            "max_z": -2.0,
            "severity": 1.0,
        },
    ),
    "velocity": RuleConfig(
        weight=25.0,
        label="Velocity",
        params={
            "window_minutes": VELOCITY_WINDOW_MINUTES,
            "threshold": VELOCITY_THRESHOLD,
            # severity = min(1.0, base_severity + severity_step * (prior_count - threshold))
            "base_severity": 0.5,
            "severity_step": 0.25,
        },
    ),
    "unusual_hour": RuleConfig(
        weight=18.0,
        label="Unusual hour",
        params={
            "base_severity": 0.5,
            # Hours late_night_start..late_night_end inclusive (00:00-05:59) get the higher severity.
            "late_night_start": 0,
            "late_night_end": 5,
            "late_night_severity": 0.9,
        },
    ),
    "category_mismatch": RuleConfig(
        weight=20.0,
        label="Category mismatch",
        params={
            "high_risk_severity": 0.85,
            "standard_severity": 0.4,
        },
    ),
    "geographic_anomaly": RuleConfig(
        weight=35.0,
        label="Geographic anomaly",
        params={
            "min_distance_miles": 100.0,
            # severity = min(distance_severity_cap,
            #                base_severity + (distance - min_distance_miles) / distance_ramp_miles)
            "base_severity": 0.3,
            "distance_ramp_miles": 2000.0,
            "distance_severity_cap": 0.7,
            "travel_lookback_hours": 12.0,
            "max_travel_mph": MAX_TRAVEL_MPH,
            "impossible_travel_severity": 1.0,
        },
    ),
    "round_amount": RuleConfig(
        weight=10.0,
        label="Round amount",
        params={
            "min_amount": 50.0,
            # [multiple, severity], checked in order; the first exact multiple wins.
            "tiers": [[500, 1.0], [100, 0.7], [50, 0.4]],
        },
    ),
}


def with_weights(weights: Mapping[str, float], registry: Mapping[str, RuleConfig] = RULES) -> dict[str, RuleConfig]:
    """Return a copy of ``registry`` with the given rule weights replaced.

    The original registry is not modified. Unknown rule names raise ``KeyError``.
    """
    unknown = set(weights) - set(registry)
    if unknown:
        raise KeyError(f"unknown rules: {sorted(unknown)}")
    return {
        name: replace(cfg, weight=weights.get(name, cfg.weight), params=copy.deepcopy(cfg.params))
        for name, cfg in registry.items()
    }
