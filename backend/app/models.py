from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Category(str, Enum):
    GROCERIES = "groceries"
    RESTAURANTS = "restaurants"
    GAS = "gas"
    RETAIL = "retail"
    ELECTRONICS = "electronics"
    TRAVEL = "travel"
    ENTERTAINMENT = "entertainment"
    UTILITIES = "utilities"
    HEALTHCARE = "healthcare"
    GIFT_CARDS = "gift_cards"
    CASH_ADVANCE = "cash_advance"
    JEWELRY = "jewelry"


HIGH_RISK_CATEGORIES: frozenset[Category] = frozenset(
    {Category.GIFT_CARDS, Category.CASH_ADVANCE, Category.JEWELRY, Category.ELECTRONICS}
)


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float = Field(gt=0)
    merchant: str
    category: Category
    timestamp: datetime
    city: str
    state: str
    latitude: float
    longitude: float
    # Ground truth for evaluation only. Never surfaced to users.
    is_fraud: bool = False


class UserProfile(BaseModel):
    user_id: str
    home_city: str
    home_state: str
    home_latitude: float
    home_longitude: float
    avg_amount: float
    std_amount: float
    typical_categories: list[Category]
    active_hour_start: int = Field(ge=0, le=23)
    active_hour_end: int = Field(ge=0, le=23)


class FraudFlag(BaseModel):
    rule: str
    severity: float = Field(ge=0.0, le=1.0)
    weight: float
    detail: str

    @property
    def points(self) -> float:
        return self.severity * self.weight


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ExplanationSubject(BaseModel):
    """What was assessed, described for the explainer.

    Each detection engine builds one, so the explainer never needs to know which
    engine produced the flags. Every string here is reader-facing.
    """

    # What the thing is called in a sentence: "transaction", "message".
    noun: str
    # Labelled facts shown to the model, in order: ("Amount", "$12.00").
    facts: list[tuple[str, str]] = Field(default_factory=list)
    # Opens the deterministic explanation, completed by " scored ...":
    # "This transaction of $12.00 at Shop".
    summary: str
    review_threshold: float
    # The recommended action for each risk level, used when the model is not.
    actions: dict[RiskLevel, str]


class RiskAssessment(BaseModel):
    transaction_id: str
    risk_score: float
    risk_level: RiskLevel
    flags: list[FraudFlag] = Field(default_factory=list)

    @staticmethod
    def level_for(score: float) -> RiskLevel:
        if score >= 75:
            return RiskLevel.CRITICAL
        if score >= 50:
            return RiskLevel.HIGH
        if score >= 25:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
