"""FastAPI surface for FinShield.

Everything the API returns is display-facing, so this module is the mapping
layer: rule keys and category values are snake_case internally and are converted
to human labels here. ``is_fraud`` is evaluation ground truth and never appears
in a response — the request models reject it outright.

The routes depend on the ``TransactionRepository`` protocol, not on
``InMemoryRepository``, and the repository is supplied as a dependency so tests
and a future Postgres store can swap it.
"""

from __future__ import annotations

import os
from datetime import datetime
from functools import lru_cache
from typing import Literal, Mapping, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .ask import AskUnavailable
from .ask import answer as answer_question
from .detection import assess, category_label, compound_multiplier, transaction_subject
from .explainer import Explanation, explain, indicator_label
from .generator import CITIES
from .message_detection import assess_message, message_subject
from .message_rules import MESSAGE_RULES
from .message_rules import REVIEW_THRESHOLD as MESSAGE_REVIEW_THRESHOLD
from .models import Category, FraudFlag, RiskAssessment, RiskLevel, Transaction, UserProfile
from .repository import InMemoryRepository, TransactionRepository
from .rules import MAX_SCORE, RuleConfig

load_dotenv()

app = FastAPI(
    title="FinShield",
    version="0.1.0",
    description="Transaction risk assessment. Scores are produced by a deterministic rules engine.",
)

# Locally the default is permissive; deployments set ALLOWED_ORIGINS explicitly.
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
# Optional pattern for origins that are not known in advance, such as Vercel's
# per-branch and per-deployment preview addresses. Matched against the whole origin.
_origin_regex = os.environ.get("ALLOWED_ORIGIN_REGEX") or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=_origin_regex,
    # The API uses no cookies or auth headers, so cross-origin credentials are never needed.
    allow_credentials=False,
    # The client only reads and posts JSON.
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@lru_cache(maxsize=1)
def _default_repository() -> InMemoryRepository:
    return InMemoryRepository.from_generated()


def get_repository() -> TransactionRepository:
    """Dependency override point: tests and other stores replace this."""
    return _default_repository()


# --- Views ---------------------------------------------------------------------
#
# Reader-facing shapes. No snake_case identifiers, no ground truth.


class IndicatorView(BaseModel):
    indicator: str
    severity: float
    weight: float
    points: float
    detail: str

    @classmethod
    def of(cls, flag: FraudFlag, rules: Mapping[str, RuleConfig]) -> "IndicatorView":
        """``rules`` is the registry the flag came from, for its label."""
        return cls(
            indicator=indicator_label(flag.rule, rules),
            severity=flag.severity,
            weight=flag.weight,
            points=flag.points,
            detail=flag.detail,
        )


class ScoreBreakdown(BaseModel):
    """How the indicator points become the score, so the client can draw the
    decomposition without recomputing anything. Uses the same compound and cap
    rules as ``detection.assess``."""

    indicator_points: float
    compound_multiplier: float
    # Points added by the compound multiplier; 0 when fewer than the minimum fire.
    compound_bonus: float
    # indicator_points * compound_multiplier, before the cap.
    uncapped_score: float
    capped: bool
    max_score: float
    review_threshold: float

    @classmethod
    def of(cls, assessment: RiskAssessment, review_threshold: float) -> "ScoreBreakdown":
        points = sum(f.points for f in assessment.flags)
        multiplier = compound_multiplier(len(assessment.flags))
        uncapped = points * multiplier
        return cls(
            indicator_points=points,
            compound_multiplier=multiplier,
            compound_bonus=uncapped - points,
            uncapped_score=uncapped,
            capped=uncapped > MAX_SCORE,
            max_score=MAX_SCORE,
            review_threshold=review_threshold,
        )


def not_triggered(assessment: RiskAssessment, rules: Mapping[str, RuleConfig]) -> list[str]:
    """Labels of the rules that were checked and did not fire, in registry order."""
    fired = {f.rule for f in assessment.flags}
    return [indicator_label(rule, rules) for rule in rules if rule not in fired]


class AssessmentView(BaseModel):
    transaction_id: str
    risk_score: float
    risk_level: RiskLevel
    flagged_for_review: bool
    indicators: list[IndicatorView]
    indicators_not_triggered: list[str]
    breakdown: ScoreBreakdown

    @classmethod
    def of(
        cls, assessment: RiskAssessment, review_threshold: float, rules: Mapping[str, RuleConfig]
    ) -> "AssessmentView":
        return cls(
            transaction_id=assessment.transaction_id,
            risk_score=assessment.risk_score,
            risk_level=assessment.risk_level,
            flagged_for_review=assessment.risk_score >= review_threshold,
            indicators=[IndicatorView.of(f, rules) for f in assessment.flags],
            indicators_not_triggered=not_triggered(assessment, rules),
            breakdown=ScoreBreakdown.of(assessment, review_threshold),
        )


class TransactionView(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: str
    # Human label: the underlying category value is snake_case.
    category: str
    timestamp: datetime
    city: str
    state: str
    risk_score: float
    risk_level: RiskLevel
    flagged_for_review: bool
    indicator_count: int
    # Label of the indicator that contributed the most points; None when none fired.
    top_indicator: Optional[str] = None

    @classmethod
    def of(
        cls, txn: Transaction, assessment: RiskAssessment, review_threshold: float
    ) -> "TransactionView":
        return cls(
            transaction_id=txn.transaction_id,
            user_id=txn.user_id,
            amount=txn.amount,
            merchant=txn.merchant,
            category=category_label(txn.category),
            timestamp=txn.timestamp,
            city=txn.city,
            state=txn.state,
            risk_score=assessment.risk_score,
            risk_level=assessment.risk_level,
            flagged_for_review=assessment.risk_score >= review_threshold,
            indicator_count=len(assessment.flags),
            # Flags arrive most points first (see ``detection.assess``).
            top_indicator=indicator_label(assessment.flags[0].rule) if assessment.flags else None,
        )


# Where an explanation came from: "model", or why the deterministic fallback was
# used ("no_indicators", "no_api_key", "model_unavailable"). An enum like
# ``risk_level``: the client maps it to display text through a fixed lookup.
ExplanationSource = Literal["model", "no_indicators", "no_api_key", "model_unavailable"]


def explanation_source(written: Explanation) -> ExplanationSource:
    return "model" if written.source == "model" else written.fallback_reason or "model_unavailable"


class TransactionDetail(TransactionView):
    indicators: list[IndicatorView]
    # Labels of the rules that were checked and did not fire, in registry order.
    indicators_not_triggered: list[str]
    breakdown: ScoreBreakdown
    explanation: Optional[str] = None
    action: Optional[str] = None
    explanation_source: Optional[ExplanationSource] = None


class CustomerView(BaseModel):
    user_id: str
    home_city: str
    home_state: str
    average_amount: float
    typical_categories: list[str]
    active_hours: str
    transaction_count: int

    @classmethod
    def of(cls, profile: UserProfile, transaction_count: int) -> "CustomerView":
        return cls(
            user_id=profile.user_id,
            home_city=profile.home_city,
            home_state=profile.home_state,
            average_amount=profile.avg_amount,
            typical_categories=[category_label(c) for c in profile.typical_categories],
            active_hours=f"{profile.active_hour_start:02d}:00-{profile.active_hour_end:02d}:59",
            transaction_count=transaction_count,
        )


class CategoryStat(BaseModel):
    category: str
    count: int
    total_amount: float


class IndicatorStat(BaseModel):
    indicator: str
    count: int


class Stats(BaseModel):
    total_transactions: int
    total_amount: float
    total_customers: int
    flagged_for_review: int
    flagged_rate: float
    risk_levels: dict[RiskLevel, int]
    by_category: list[CategoryStat]
    indicators_triggered: list[IndicatorStat]


class CategoryOption(BaseModel):
    # ``value`` is the snake_case enum value to submit; it is never displayed.
    value: Category
    label: str


class CityOption(BaseModel):
    city: str
    state: str
    latitude: float
    longitude: float


class Reference(BaseModel):
    categories: list[CategoryOption]
    cities: list[CityOption]


class AnalyzeRequest(BaseModel):
    """A transaction to score. ``is_fraud`` is deliberately absent and rejected."""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    amount: float = Field(gt=0)
    merchant: str
    category: Category
    timestamp: datetime
    city: str
    state: str
    latitude: float
    longitude: float
    transaction_id: str = "unassigned"


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Room for a pasted message (up to 20,000 characters, as on /analyze-message) and a question.
    question: str = Field(min_length=1, max_length=21_000)


class ToolArgumentView(BaseModel):
    name: str
    value: str


class ToolCallView(BaseModel):
    """One lookup the answer was built from, labelled for display."""

    tool: str
    arguments: list[ToolArgumentView]


class AskResponse(BaseModel):
    # Model output with citations removed; render as text only.
    answer: str
    # Ids of the transactions the answer cites, in order of first citation. Each
    # appeared in a tool result for this question.
    transaction_ids: list[str]
    # The same transactions, for linking.
    transactions: list[TransactionView]
    checked: list[ToolCallView]


class AnalyzeResponse(BaseModel):
    assessment: AssessmentView
    explanation: Optional[str] = None
    action: Optional[str] = None
    explanation_source: Optional[ExplanationSource] = None


# --- Routes --------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(
    request: AnalyzeRequest,
    explanation: bool = Query(True, description="Include a plain-English explanation."),
    repo: TransactionRepository = Depends(get_repository),
) -> AnalyzeResponse:
    """Score one transaction against the customer's profile and prior activity.

    Scoring is deterministic and happens before any explanation is requested, so
    the response is identical whether or not an explanation is included.
    """
    profile = repo.get_profile(request.user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"No customer profile for '{request.user_id}'")

    txn = Transaction(**request.model_dump())
    assessment = assess(txn, profile, repo.get_user_transactions(request.user_id))
    view = AssessmentView.of(assessment, repo.review_threshold, repo.rules)
    if not explanation:
        return AnalyzeResponse(assessment=view)

    written = explain(transaction_subject(txn, repo.review_threshold), assessment, repo.rules)
    return AnalyzeResponse(
        assessment=view,
        explanation=written.explanation,
        action=written.action,
        explanation_source=explanation_source(written),
    )


class AnalyzeMessageRequest(BaseModel):
    """A message to screen: raw text, optionally opening with From, Reply-To and
    Subject header lines."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=20_000)


@app.post("/analyze-message", response_model=AnalyzeResponse)
def analyze_message(
    request: AnalyzeMessageRequest,
    explanation: bool = Query(True, description="Include a plain-English explanation."),
) -> AnalyzeResponse:
    """Score one message with the message rules. The response has the same shape
    as ``/analyze``: the same scoring, breakdown and explainer, with the message
    registry in place of the transaction registry."""
    assessment = assess_message(request.text)
    view = AssessmentView.of(assessment, MESSAGE_REVIEW_THRESHOLD, MESSAGE_RULES)
    if not explanation:
        return AnalyzeResponse(assessment=view)

    written = explain(message_subject(request.text, MESSAGE_REVIEW_THRESHOLD), assessment, MESSAGE_RULES)
    return AnalyzeResponse(
        assessment=view,
        explanation=written.explanation,
        action=written.action,
        explanation_source=explanation_source(written),
    )


@app.get("/reference", response_model=Reference)
def reference() -> Reference:
    """Choices for the analyze form, so the client keeps no copy of either list."""
    return Reference(
        categories=[CategoryOption(value=c.value, label=category_label(c)) for c in Category],
        cities=[
            CityOption(city=city, state=state, latitude=lat, longitude=lon)
            for city, state, lat, lon in CITIES
        ],
    )


@app.get("/users", response_model=list[CustomerView])
def list_users(repo: TransactionRepository = Depends(get_repository)) -> list[CustomerView]:
    return [
        CustomerView.of(profile, len(repo.get_user_transactions(profile.user_id)))
        for profile in repo.list_profiles()
    ]


@app.get("/transactions", response_model=list[TransactionView])
def list_transactions(
    user_id: Optional[str] = None,
    flagged_only: bool = False,
    limit: int = Query(100, ge=1, le=1000),
    order: Literal["newest", "risk"] = Query(
        "newest", description="'newest' first, or highest 'risk' score first."
    ),
    repo: TransactionRepository = Depends(get_repository),
) -> list[TransactionView]:
    """Transactions newest first, or highest risk score first, optionally narrowed
    to one customer or to those flagged for review."""
    if user_id is not None and repo.get_profile(user_id) is None:
        raise HTTPException(status_code=404, detail=f"No customer profile for '{user_id}'")

    # Ordering by risk needs every match before the limit applies.
    fetch_limit = None if order == "risk" else limit
    views = []
    for txn in repo.list_transactions(user_id=user_id, flagged_only=flagged_only, limit=fetch_limit):
        assessment = repo.get_assessment(txn.transaction_id)
        if assessment is None:
            continue
        views.append(TransactionView.of(txn, assessment, repo.review_threshold))
    if order == "risk":
        # Ties break on id so the order is the same on every request.
        views.sort(key=lambda v: (-v.risk_score, v.transaction_id))
        views = views[:limit]
    return views


@app.get("/transactions/{transaction_id}", response_model=TransactionDetail)
def get_transaction(
    transaction_id: str,
    explanation: bool = Query(True, description="Include a plain-English explanation."),
    repo: TransactionRepository = Depends(get_repository),
) -> TransactionDetail:
    """One transaction with its full score decomposition. The explanation is
    written after scoring and never affects it; pass ``explanation=false`` to skip
    it and answer without waiting on the model."""
    txn = repo.get_transaction(transaction_id)
    assessment = repo.get_assessment(transaction_id) if txn is not None else None
    if txn is None or assessment is None:
        raise HTTPException(status_code=404, detail=f"No transaction '{transaction_id}'")

    base = TransactionView.of(txn, assessment, repo.review_threshold)
    detail = TransactionDetail(
        **base.model_dump(),
        indicators=[IndicatorView.of(f, repo.rules) for f in assessment.flags],
        indicators_not_triggered=not_triggered(assessment, repo.rules),
        breakdown=ScoreBreakdown.of(assessment, repo.review_threshold),
    )
    if explanation:
        written = explain(transaction_subject(txn, repo.review_threshold), assessment, repo.rules)
        detail.explanation = written.explanation
        detail.action = written.action
        detail.explanation_source = explanation_source(written)
    return detail


_ASK_UNAVAILABLE = {
    "no_api_key": "Questions need the Anthropic API, and no API key is configured.",
    "model_unavailable": "The question could not be answered because Claude could not be reached.",
}


@app.post("/ask", response_model=AskResponse)
def ask(request: AskRequest, repo: TransactionRepository = Depends(get_repository)) -> AskResponse:
    """Answer a question about the dataset from lookups only.

    The model reads transactions, assessments, aggregates and the rule registry
    through read-only tools and reports what they return. It never scores
    anything. ``checked`` lists every lookup it made.
    """
    try:
        result = answer_question(request.question, repo)
    except AskUnavailable as err:
        reason = str(err)
        raise HTTPException(status_code=503, detail=_ASK_UNAVAILABLE.get(reason, _ASK_UNAVAILABLE["model_unavailable"]))

    transactions = []
    for transaction_id in result.transaction_ids:
        txn = repo.get_transaction(transaction_id)
        assessment = repo.get_assessment(transaction_id)
        if txn is not None and assessment is not None:
            transactions.append(TransactionView.of(txn, assessment, repo.review_threshold))
    return AskResponse(
        answer=result.text,
        transaction_ids=[t.transaction_id for t in transactions],
        transactions=transactions,
        checked=[
            ToolCallView(
                tool=call.tool,
                arguments=[ToolArgumentView(name=name, value=value) for name, value in call.arguments],
            )
            for call in result.calls
        ],
    )


@app.get("/stats", response_model=Stats)
def stats(repo: TransactionRepository = Depends(get_repository)) -> Stats:
    transactions = repo.list_transactions(limit=None)

    risk_levels = {level: 0 for level in RiskLevel}
    category_counts: dict[Category, int] = {}
    category_amounts: dict[Category, float] = {}
    indicator_counts: dict[str, int] = {}
    flagged = 0

    for txn in transactions:
        assessment = repo.get_assessment(txn.transaction_id)
        if assessment is None:
            continue
        risk_levels[assessment.risk_level] += 1
        if assessment.risk_score >= repo.review_threshold:
            flagged += 1
        category_counts[txn.category] = category_counts.get(txn.category, 0) + 1
        category_amounts[txn.category] = category_amounts.get(txn.category, 0.0) + txn.amount
        for flag in assessment.flags:
            indicator_counts[flag.rule] = indicator_counts.get(flag.rule, 0) + 1

    total = len(transactions)
    by_category = sorted(
        (
            CategoryStat(
                category=category_label(category),
                count=count,
                total_amount=category_amounts[category],
            )
            for category, count in category_counts.items()
        ),
        key=lambda s: (-s.total_amount, s.category),
    )
    indicators = sorted(
        (
            IndicatorStat(indicator=indicator_label(rule), count=count)
            for rule, count in indicator_counts.items()
        ),
        key=lambda s: (-s.count, s.indicator),
    )
    return Stats(
        total_transactions=total,
        total_amount=sum(category_amounts.values()),
        total_customers=len(repo.list_profiles()),
        flagged_for_review=flagged,
        flagged_rate=flagged / total if total else 0.0,
        risk_levels=risk_levels,
        by_category=by_category,
        indicators_triggered=indicators,
    )
