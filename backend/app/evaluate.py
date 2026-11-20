"""Measure the transaction detector against labelled synthetic data.

``evaluate`` and ``sweep`` are plain functions: they take a rule registry (or
weight overrides) and datasets, run in-process, write nothing, and return
metrics. A tuning agent can call them to check a proposed weight change.

The ground truth is ``Transaction.is_fraud``, which exists only for this
purpose and is never shown to users.

Two measures, because they answer different questions:

- **Episode recall.** Each fraud customer in a generated dataset has exactly one
  fraud episode: a burst of related transactions. An episode counts as caught if
  any of its transactions scores at or above the threshold, because one flag is
  enough to put the customer's account in front of a reviewer.
- **False positives.** Legitimate transactions scoring at or above the
  threshold. Every one is a customer bothered for nothing.

These numbers describe synthetic data built around the patterns the rules were
written for. They show the rules do what they were designed to do; they are not
an estimate of performance on real fraud.

Run the default sweep from ``backend/``::

    python -m app.evaluate
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Mapping, Optional, Sequence

from .detection import assess_all
from .generator import generate_dataset
from .models import Transaction, UserProfile
from .rules import REVIEW_THRESHOLD, RULES, RuleConfig, with_weights

Dataset = tuple[list[UserProfile], list[Transaction]]
Registry = Mapping[str, RuleConfig]

DEFAULT_SEEDS: tuple[int, ...] = (42, 7, 1234, 2026, 99)
DEFAULT_THRESHOLDS: tuple[float, ...] = (20, 25, 30, 35, 40, 45, 50)


@dataclass(frozen=True)
class Metrics:
    threshold: float
    episodes: int
    episodes_caught: int
    legitimate: int
    false_positives: int
    fraud_transactions: int
    fraud_transactions_flagged: int

    @property
    def episode_recall(self) -> float:
        return self.episodes_caught / self.episodes if self.episodes else 0.0

    @property
    def false_positive_rate(self) -> float:
        return self.false_positives / self.legitimate if self.legitimate else 0.0

    @property
    def transaction_recall(self) -> float:
        return self.fraud_transactions_flagged / self.fraud_transactions if self.fraud_transactions else 0.0


def generated_datasets(seeds: Iterable[int] = DEFAULT_SEEDS) -> list[Dataset]:
    """One generated dataset per seed, with the generator's default settings."""
    return [generate_dataset(seed=seed) for seed in seeds]


def _registry(registry: Optional[Registry], weights: Optional[Mapping[str, float]]) -> Registry:
    base = RULES if registry is None else registry
    return with_weights(weights, base) if weights else base


def _scored(datasets: Sequence[Dataset], registry: Registry) -> list[tuple[list[Transaction], list[float]]]:
    """Every transaction's score, computed once and reused across thresholds."""
    runs = []
    for profiles, transactions in datasets:
        assessments = assess_all(transactions, profiles, registry)
        runs.append((transactions, [a.risk_score for a in assessments]))
    return runs


def _measure(runs: Sequence[tuple[list[Transaction], list[float]]], threshold: float) -> Metrics:
    episodes = caught = legitimate = false_positives = fraud = fraud_flagged = 0
    for transactions, scores in runs:
        flagged_by_episode: dict[str, bool] = defaultdict(bool)
        for txn, score in zip(transactions, scores):
            hit = score >= threshold
            if txn.is_fraud:
                fraud += 1
                fraud_flagged += hit
                # One episode per fraud customer per dataset.
                flagged_by_episode[txn.user_id] |= hit
            else:
                legitimate += 1
                false_positives += hit
        episodes += len(flagged_by_episode)
        caught += sum(flagged_by_episode.values())
    return Metrics(
        threshold=threshold,
        episodes=episodes,
        episodes_caught=caught,
        legitimate=legitimate,
        false_positives=false_positives,
        fraud_transactions=fraud,
        fraud_transactions_flagged=fraud_flagged,
    )


def evaluate(
    registry: Optional[Registry] = None,
    *,
    weights: Optional[Mapping[str, float]] = None,
    threshold: float = REVIEW_THRESHOLD,
    datasets: Optional[Sequence[Dataset]] = None,
) -> Metrics:
    """Metrics for one registry at one threshold.

    ``weights`` overrides individual rule weights on top of ``registry`` without
    modifying it. ``datasets`` defaults to the five standard seeded datasets.
    """
    data = generated_datasets() if datasets is None else datasets
    return _measure(_scored(data, _registry(registry, weights)), threshold)


def sweep(
    thresholds: Iterable[float] = DEFAULT_THRESHOLDS,
    registry: Optional[Registry] = None,
    *,
    weights: Optional[Mapping[str, float]] = None,
    datasets: Optional[Sequence[Dataset]] = None,
) -> list[Metrics]:
    """Metrics at each threshold. Scores are computed once and reused."""
    data = generated_datasets() if datasets is None else datasets
    runs = _scored(data, _registry(registry, weights))
    return [_measure(runs, t) for t in thresholds]


def format_table(results: Sequence[Metrics]) -> str:
    lines = [
        f"{'Threshold':>9}  {'Episodes caught':>17}  {'Recall':>7}  {'False positives':>22}",
    ]
    for m in results:
        marker = "  <- current" if m.threshold == REVIEW_THRESHOLD else ""
        lines.append(
            f"{m.threshold:>9g}  {m.episodes_caught:>7} of {m.episodes:<6}  {m.episode_recall:>6.1%}  "
            f"{m.false_positives:>6} of {m.legitimate:<6} {m.false_positive_rate:>6.2%}{marker}"
        )
    return "\n".join(lines)


def main() -> None:
    print(f"Seeds: {', '.join(map(str, DEFAULT_SEEDS))} (synthetic data)\n")
    print(format_table(sweep()))


if __name__ == "__main__":
    main()
