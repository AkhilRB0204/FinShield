"""``TransactionRepository`` backed by SQL, using SQLite from the standard library.

Four tables, one row per thing they describe:

- ``customers``: one row per customer profile.
- ``transactions``: one row per transaction, indexed by customer and time.
- ``assessments``: one row per transaction, holding its risk score and level.
- ``flags``: one row per indicator that fired on a transaction, in the order the
  detector reported them.

Scores are computed once by the detection engine when the store is built, then
stored. Nothing here scores, rounds or re-derives a number: SQLite stores floats
as 8-byte IEEE doubles, so a score read back is the score the engine produced.

The queries use only portable SQL (joins, ``WHERE``, ``ORDER BY``, ``LIMIT`` and
placeholders), so a Postgres-backed store would change the connection and the
placeholder style, not the queries' logic.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from typing import Iterable, Mapping, Optional

from .detection import assess_all
from .generator import generate_dataset
from .models import (
    Category,
    FraudFlag,
    RiskAssessment,
    RiskLevel,
    Transaction,
    UserProfile,
)
from .rules import REVIEW_THRESHOLD, RULES, RuleConfig

_SCHEMA = """
CREATE TABLE customers (
    user_id            TEXT PRIMARY KEY,
    home_city          TEXT NOT NULL,
    home_state         TEXT NOT NULL,
    home_latitude      REAL NOT NULL,
    home_longitude     REAL NOT NULL,
    avg_amount         REAL NOT NULL,
    std_amount         REAL NOT NULL,
    typical_categories TEXT NOT NULL,  -- JSON array of category values
    active_hour_start  INTEGER NOT NULL,
    active_hour_end    INTEGER NOT NULL,
    position           INTEGER NOT NULL  -- the order profiles were supplied in
);

CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES customers (user_id),
    amount         REAL NOT NULL CHECK (amount > 0),
    merchant       TEXT NOT NULL,
    category       TEXT NOT NULL,
    timestamp      TEXT NOT NULL,  -- ISO 8601, so text order is time order
    city           TEXT NOT NULL,
    state          TEXT NOT NULL,
    latitude       REAL NOT NULL,
    longitude      REAL NOT NULL,
    is_fraud       INTEGER NOT NULL  -- evaluation ground truth; never displayed
);
CREATE INDEX transactions_by_time ON transactions (timestamp, transaction_id);
CREATE INDEX transactions_by_customer ON transactions (user_id, timestamp, transaction_id);

CREATE TABLE assessments (
    transaction_id TEXT PRIMARY KEY REFERENCES transactions (transaction_id),
    risk_score     REAL NOT NULL,
    risk_level     TEXT NOT NULL
);
CREATE INDEX assessments_by_score ON assessments (risk_score);

CREATE TABLE flags (
    transaction_id TEXT NOT NULL REFERENCES transactions (transaction_id),
    position       INTEGER NOT NULL,
    rule           TEXT NOT NULL,
    severity       REAL NOT NULL,
    weight         REAL NOT NULL,
    detail         TEXT NOT NULL,
    PRIMARY KEY (transaction_id, position)
);
CREATE INDEX flags_by_rule ON flags (rule);
"""

_TRANSACTION_COLUMNS = (
    "t.transaction_id, t.user_id, t.amount, t.merchant, t.category, t.timestamp, "
    "t.city, t.state, t.latitude, t.longitude, t.is_fraud"
)


class SqliteRepository:
    """``TransactionRepository`` over a SQLite database.

    ``path`` defaults to an in-memory database, which suits the generated demo
    dataset: it is rebuilt on every start, so there is nothing to persist. A file
    path works too.
    """

    def __init__(
        self,
        profiles: Iterable[UserProfile],
        transactions: Iterable[Transaction],
        rules: Mapping[str, RuleConfig] = RULES,
        review_threshold: float = REVIEW_THRESHOLD,
        path: str = ":memory:",
    ) -> None:
        self.review_threshold = review_threshold
        self.rules = rules
        # FastAPI runs sync routes on a thread pool, so one connection is shared
        # across threads and every use of it holds this lock.
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA foreign_keys = ON")

        profiles = list(profiles)
        chronological = sorted(transactions, key=lambda t: (t.timestamp, t.transaction_id))
        assessments = assess_all(chronological, profiles, rules)
        with self._lock, self._db:
            self._db.executescript(_SCHEMA)
            self._db.executemany(
                "INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        p.user_id, p.home_city, p.home_state, p.home_latitude, p.home_longitude,
                        p.avg_amount, p.std_amount, json.dumps([c.value for c in p.typical_categories]),
                        p.active_hour_start, p.active_hour_end, i,
                    )
                    for i, p in enumerate(profiles)
                ],
            )
            self._db.executemany(
                "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        t.transaction_id, t.user_id, t.amount, t.merchant, t.category.value,
                        t.timestamp.isoformat(timespec="microseconds"), t.city, t.state, t.latitude, t.longitude, int(t.is_fraud),
                    )
                    for t in chronological
                ],
            )
            self._db.executemany(
                "INSERT INTO assessments VALUES (?, ?, ?)",
                [(a.transaction_id, a.risk_score, a.risk_level.value) for a in assessments],
            )
            self._db.executemany(
                "INSERT INTO flags VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (a.transaction_id, i, f.rule, f.severity, f.weight, f.detail)
                    for a in assessments
                    for i, f in enumerate(a.flags)
                ],
            )

    @classmethod
    def from_generated(cls, path: str = ":memory:", **kwargs) -> "SqliteRepository":
        """Build a store from the synthetic generator. ``kwargs`` go to
        ``generate_dataset``."""
        profiles, transactions = generate_dataset(**kwargs)
        return cls(profiles, transactions, path=path)

    # --- Reads ---------------------------------------------------------------

    def _rows(self, sql: str, params: tuple = ()) -> list[tuple]:
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def list_profiles(self) -> list[UserProfile]:
        rows = self._rows("SELECT * FROM customers ORDER BY position")
        return [_profile(r) for r in rows]

    def get_profile(self, user_id: str) -> Optional[UserProfile]:
        rows = self._rows("SELECT * FROM customers WHERE user_id = ?", (user_id,))
        return _profile(rows[0]) if rows else None

    def get_user_transactions(self, user_id: str) -> list[Transaction]:
        """This user's transactions, oldest first."""
        rows = self._rows(
            f"SELECT {_TRANSACTION_COLUMNS} FROM transactions t "
            "WHERE t.user_id = ? ORDER BY t.timestamp, t.transaction_id",
            (user_id,),
        )
        return [_transaction(r) for r in rows]

    def list_transactions(
        self,
        user_id: Optional[str] = None,
        flagged_only: bool = False,
        limit: Optional[int] = None,
    ) -> list[Transaction]:
        """Transactions newest first. ``limit`` of ``None`` returns all matches."""
        if limit is not None and limit <= 0:
            return []
        sql = [f"SELECT {_TRANSACTION_COLUMNS} FROM transactions t"]
        where: list[str] = []
        params: list = []
        if flagged_only:
            sql.append("JOIN assessments a ON a.transaction_id = t.transaction_id")
            where.append("a.risk_score >= ?")
            params.append(self.review_threshold)
        if user_id is not None:
            where.append("t.user_id = ?")
            params.append(user_id)
        if where:
            sql.append("WHERE " + " AND ".join(where))
        sql.append("ORDER BY t.timestamp DESC, t.transaction_id DESC")
        if limit is not None:
            sql.append("LIMIT ?")
            params.append(limit)
        return [_transaction(r) for r in self._rows(" ".join(sql), tuple(params))]

    def get_transaction(self, transaction_id: str) -> Optional[Transaction]:
        rows = self._rows(
            f"SELECT {_TRANSACTION_COLUMNS} FROM transactions t WHERE t.transaction_id = ?",
            (transaction_id,),
        )
        return _transaction(rows[0]) if rows else None

    def get_assessment(self, transaction_id: str) -> Optional[RiskAssessment]:
        with self._lock:
            head = self._db.execute(
                "SELECT risk_score, risk_level FROM assessments WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            if head is None:
                return None
            flags = self._db.execute(
                "SELECT rule, severity, weight, detail FROM flags "
                "WHERE transaction_id = ? ORDER BY position",
                (transaction_id,),
            ).fetchall()
        return RiskAssessment(
            transaction_id=transaction_id,
            risk_score=head[0],
            risk_level=RiskLevel(head[1]),
            flags=[FraudFlag(rule=r, severity=s, weight=w, detail=d) for r, s, w, d in flags],
        )

    def is_flagged(self, transaction_id: str) -> bool:
        rows = self._rows(
            "SELECT 1 FROM assessments WHERE transaction_id = ? AND risk_score >= ?",
            (transaction_id, self.review_threshold),
        )
        return bool(rows)


def _profile(row: tuple) -> UserProfile:
    return UserProfile(
        user_id=row[0],
        home_city=row[1],
        home_state=row[2],
        home_latitude=row[3],
        home_longitude=row[4],
        avg_amount=row[5],
        std_amount=row[6],
        typical_categories=[Category(c) for c in json.loads(row[7])],
        active_hour_start=row[8],
        active_hour_end=row[9],
    )


def _transaction(row: tuple) -> Transaction:
    return Transaction(
        transaction_id=row[0],
        user_id=row[1],
        amount=row[2],
        merchant=row[3],
        category=Category(row[4]),
        timestamp=datetime.fromisoformat(row[5]),
        city=row[6],
        state=row[7],
        latitude=row[8],
        longitude=row[9],
        is_fraud=bool(row[10]),
    )
