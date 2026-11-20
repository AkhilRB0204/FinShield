"""Budgets for language-model calls on a public demo.

Scoring never consumes a budget: only the calls that reach a model provider do,
so a visitor who runs out still gets every score, breakdown and indicator.

Two independent budgets, each with a per-visitor rate and a daily total:

- ``QUESTIONS`` for ``/ask``. One question can take several model turns.
- ``EXPLANATIONS`` for plain-English explanations.

Limits come from the environment so a deployment can tune them to its
provider's quota without a code change. Counters live in memory, which suits a
single free-tier instance; they reset when the process restarts.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Request

Denial = Literal["visitor", "daily"]


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


@dataclass
class Budget:
    """At most ``per_minute`` calls per visitor in any 60 seconds, and at most
    ``per_day`` calls in total per UTC day. Zero disables that limit."""

    per_minute: int
    per_day: int
    _recent: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))
    _day: str = ""
    _day_count: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def take(self, visitor: str, now: Optional[float] = None) -> Optional[Denial]:
        """Spend one call for ``visitor``. Returns ``None`` when allowed, or
        which limit refused it. A refused call spends nothing."""
        now = time.time() if now is None else now
        today = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self._lock:
            if today != self._day:
                self._day, self._day_count = today, 0
            if self.per_day and self._day_count >= self.per_day:
                return "daily"
            recent = self._recent[visitor]
            while recent and now - recent[0] >= 60:
                recent.popleft()
            if self.per_minute and len(recent) >= self.per_minute:
                return "visitor"
            recent.append(now)
            self._day_count += 1
            # Forget visitors with no recent calls so the map stays small.
            if len(self._recent) > 10_000:
                for key in [k for k, q in self._recent.items() if not q or now - q[-1] >= 60]:
                    del self._recent[key]
            return None

    def reset(self) -> None:
        with self._lock:
            self._recent.clear()
            self._day, self._day_count = "", 0


QUESTIONS = Budget(
    per_minute=_env_int("ASK_PER_MINUTE", 5),
    per_day=_env_int("ASK_PER_DAY", 100),
)
EXPLANATIONS = Budget(
    per_minute=_env_int("EXPLAIN_PER_MINUTE", 20),
    per_day=_env_int("EXPLAIN_PER_DAY", 500),
)


def visitor(request: Request) -> str:
    """The client address. Behind Render's proxy the real address is the last
    ``X-Forwarded-For`` entry, the one the proxy itself appended; earlier entries
    are whatever the client sent and are not trusted."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"
