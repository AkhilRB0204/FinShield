"""The SQL store must answer every repository question exactly as the in-memory
store does: same rows, same order, same scores to the last bit."""

from __future__ import annotations

import pytest

from app.generator import generate_dataset
from app.repository import InMemoryRepository, TransactionRepository
from app.sql_repository import SqliteRepository


@pytest.fixture(scope="module", params=[42, 7])
def stores(request):
    profiles, transactions = generate_dataset(seed=request.param)
    return InMemoryRepository(profiles, transactions), SqliteRepository(profiles, transactions)


def test_satisfies_protocol(stores):
    _, sql = stores
    assert isinstance(sql, TransactionRepository)


def test_profiles_match(stores):
    mem, sql = stores
    assert sql.list_profiles() == mem.list_profiles()
    for p in mem.list_profiles():
        assert sql.get_profile(p.user_id) == p
        assert sql.get_user_transactions(p.user_id) == mem.get_user_transactions(p.user_id)
    assert sql.get_profile("nobody") is None
    assert sql.get_user_transactions("nobody") == []


@pytest.mark.parametrize("flagged_only", [False, True])
@pytest.mark.parametrize("limit", [None, 0, 1, 25, 10_000])
def test_listing_matches(stores, flagged_only, limit):
    mem, sql = stores
    users = [None] + [p.user_id for p in mem.list_profiles()[:5]]
    for user_id in users:
        assert sql.list_transactions(user_id, flagged_only, limit) == mem.list_transactions(
            user_id, flagged_only, limit
        )


def test_assessments_match_exactly(stores):
    mem, sql = stores
    for txn in mem.list_transactions(limit=None):
        tid = txn.transaction_id
        assert sql.get_transaction(tid) == txn
        # Pydantic equality compares the floats exactly: stored scores are the
        # engine's scores, not rounded copies.
        assert sql.get_assessment(tid) == mem.get_assessment(tid)
        assert sql.is_flagged(tid) == mem.is_flagged(tid)
    assert sql.get_transaction("missing") is None
    assert sql.get_assessment("missing") is None
    assert sql.is_flagged("missing") is False
