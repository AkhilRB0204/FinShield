"""The storage boundary the API depends on.

The API layer knows only ``TransactionRepository``, so a Postgres-backed store
is a second implementation of this protocol rather than a rewrite of the routes.

``InMemoryRepository`` holds the generated dataset and scores it once at
construction. Assessments are deterministic, so a cached assessment and a freshly
computed one are the same assessment.
"""

from __future__ import annotations

from typing import Iterable, Mapping, Optional, Protocol, runtime_checkable

from .detection import assess_all
from .generator import generate_dataset
from .models import RiskAssessment, Transaction, UserProfile
from .rules import REVIEW_THRESHOLD, RULES, RuleConfig


@runtime_checkable
class TransactionRepository(Protocol):
    """Read access to customers, transactions, and their risk assessments."""

    # Scores at or above this are flagged for review. Carried on the repository so
    # a store configured with a different registry reports its own threshold.
    review_threshold: float
    # The registry the assessments were scored with, so a reader can list every
    # rule that was checked, not only those that fired.
    rules: Mapping[str, RuleConfig]

    def list_profiles(self) -> list[UserProfile]: ...

    def get_profile(self, user_id: str) -> Optional[UserProfile]: ...

    def get_user_transactions(self, user_id: str) -> list[Transaction]: ...

    def list_transactions(
        self,
        user_id: Optional[str] = None,
        flagged_only: bool = False,
        limit: Optional[int] = None,
    ) -> list[Transaction]: ...

    def get_transaction(self, transaction_id: str) -> Optional[Transaction]: ...

    def get_assessment(self, transaction_id: str) -> Optional[RiskAssessment]: ...

    def is_flagged(self, transaction_id: str) -> bool: ...


class InMemoryRepository:
    """``TransactionRepository`` over an in-memory dataset."""

    def __init__(
        self,
        profiles: Iterable[UserProfile],
        transactions: Iterable[Transaction],
        rules: Mapping[str, RuleConfig] = RULES,
        review_threshold: float = REVIEW_THRESHOLD,
    ) -> None:
        self._profiles = list(profiles)
        self._profile_by_id = {p.user_id: p for p in self._profiles}
        self.review_threshold = review_threshold
        self.rules = rules

        chronological = sorted(transactions, key=lambda t: (t.timestamp, t.transaction_id))
        self._transactions = chronological
        self._transaction_by_id = {t.transaction_id: t for t in chronological}
        # Newest first: that is the order a reviewer wants a list in.
        self._newest_first = list(reversed(chronological))

        self._by_user: dict[str, list[Transaction]] = {p.user_id: [] for p in self._profiles}
        for txn in chronological:
            self._by_user.setdefault(txn.user_id, []).append(txn)

        self._assessment_by_id = {
            a.transaction_id: a for a in assess_all(chronological, self._profiles, rules)
        }

    @classmethod
    def from_generated(cls, **kwargs) -> "InMemoryRepository":
        """Build a repository from the synthetic generator. ``kwargs`` go to
        ``generate_dataset``."""
        profiles, transactions = generate_dataset(**kwargs)
        return cls(profiles, transactions)

    def list_profiles(self) -> list[UserProfile]:
        return list(self._profiles)

    def get_profile(self, user_id: str) -> Optional[UserProfile]:
        return self._profile_by_id.get(user_id)

    def get_user_transactions(self, user_id: str) -> list[Transaction]:
        """This user's transactions, oldest first."""
        return list(self._by_user.get(user_id, ()))

    def list_transactions(
        self,
        user_id: Optional[str] = None,
        flagged_only: bool = False,
        limit: Optional[int] = None,
    ) -> list[Transaction]:
        """Transactions newest first. ``limit`` of ``None`` returns all matches."""
        if limit is not None and limit <= 0:
            return []
        source = self._newest_first if user_id is None else reversed(self.get_user_transactions(user_id))
        selected: list[Transaction] = []
        for txn in source:
            if flagged_only and not self.is_flagged(txn.transaction_id):
                continue
            selected.append(txn)
            if limit is not None and len(selected) == limit:
                break
        return selected

    def get_transaction(self, transaction_id: str) -> Optional[Transaction]:
        return self._transaction_by_id.get(transaction_id)

    def get_assessment(self, transaction_id: str) -> Optional[RiskAssessment]:
        return self._assessment_by_id.get(transaction_id)

    def is_flagged(self, transaction_id: str) -> bool:
        assessment = self._assessment_by_id.get(transaction_id)
        return assessment is not None and assessment.risk_score >= self.review_threshold
