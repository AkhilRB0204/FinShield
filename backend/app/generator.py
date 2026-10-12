"""Deterministic synthetic transaction generator.

Every random draw goes through a single ``random.Random(seed)`` instance and
iteration order is fixed, so the same arguments always produce the same dataset.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta
from typing import Callable

from .models import Category, Transaction, UserProfile

# (city, state, latitude, longitude)
CITIES: list[tuple[str, str, float, float]] = [
    ("New York", "NY", 40.7128, -74.0060),
    ("Los Angeles", "CA", 34.0522, -118.2437),
    ("Chicago", "IL", 41.8781, -87.6298),
    ("Houston", "TX", 29.7604, -95.3698),
    ("Phoenix", "AZ", 33.4484, -112.0740),
    ("San Diego", "CA", 32.7157, -117.1611),
    ("Dallas", "TX", 32.7767, -96.7970),
    ("Seattle", "WA", 47.6062, -122.3321),
    ("Miami", "FL", 25.7617, -80.1918),
    ("Denver", "CO", 39.7392, -104.9903),
    ("Atlanta", "GA", 33.7490, -84.3880),
    ("Boston", "MA", 42.3601, -71.0589),
]

MERCHANTS: dict[Category, list[str]] = {
    Category.GROCERIES: ["Whole Foods", "Kroger", "Trader Joe's", "Safeway", "Aldi"],
    Category.RESTAURANTS: ["Chipotle", "Olive Garden", "Starbucks", "Panera Bread", "Local Bistro"],
    Category.GAS: ["Shell", "Chevron", "ExxonMobil", "BP", "Costco Gas"],
    Category.RETAIL: ["Target", "Walmart", "Macy's", "Amazon", "Home Depot"],
    Category.ELECTRONICS: ["Best Buy", "Apple Store", "B&H Photo", "Micro Center"],
    Category.TRAVEL: ["Delta Air Lines", "Marriott", "Uber", "Hertz", "Expedia"],
    Category.ENTERTAINMENT: ["AMC Theatres", "Netflix", "Spotify", "Ticketmaster", "Steam"],
    Category.UTILITIES: ["Comcast", "AT&T", "Verizon", "City Water Dept", "Electric Co-op"],
    Category.HEALTHCARE: ["CVS Pharmacy", "Walgreens", "Urgent Care Clinic", "Dental Associates"],
    Category.GIFT_CARDS: ["GiftCardMall", "Raise Gift Cards", "CardCash", "Prepaid Card Kiosk"],
    Category.CASH_ADVANCE: ["ATM Cash Advance", "Quick Cash Center"],
    Category.JEWELRY: ["Kay Jewelers", "Zales", "Tiffany & Co.", "Jared"],
}

# Ordered list (not a set) so sampling is deterministic.
TYPICAL_CATEGORY_POOL: list[Category] = [
    Category.GROCERIES,
    Category.RESTAURANTS,
    Category.GAS,
    Category.RETAIL,
    Category.TRAVEL,
    Category.ENTERTAINMENT,
    Category.UTILITIES,
    Category.HEALTHCARE,
]

CARD_TESTING_MERCHANTS = ["Online Donation Portal", "Digital Goods Store", "App Store Purchase", "Parking Meter Pay"]

START_DATE = datetime(2025, 1, 1)
EARTH_RADIUS_MILES = 3958.8
GEO_MIN_DISTANCE_MILES = 1000.0

FraudPattern = Callable[[random.Random, UserProfile, datetime, list[Transaction]], list[Transaction]]


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


def _txn(
    profile: UserProfile,
    amount: float,
    merchant: str,
    category: Category,
    timestamp: datetime,
    city: str,
    state: str,
    latitude: float,
    longitude: float,
    is_fraud: bool,
) -> Transaction:
    # transaction_id is assigned after the full dataset is sorted.
    return Transaction(
        transaction_id="",
        user_id=profile.user_id,
        amount=round(amount, 2),
        merchant=merchant,
        category=category,
        timestamp=timestamp,
        city=city,
        state=state,
        latitude=round(latitude, 6),
        longitude=round(longitude, 6),
        is_fraud=is_fraud,
    )


def _local_txn(
    rng: random.Random,
    profile: UserProfile,
    amount: float,
    merchant: str,
    category: Category,
    timestamp: datetime,
    is_fraud: bool,
) -> Transaction:
    """A transaction in the user's home city, jittered by a few miles."""
    return _txn(
        profile,
        amount,
        merchant,
        category,
        timestamp,
        profile.home_city,
        profile.home_state,
        profile.home_latitude + rng.uniform(-0.05, 0.05),
        profile.home_longitude + rng.uniform(-0.05, 0.05),
        is_fraud,
    )


def _make_profile(rng: random.Random, index: int) -> UserProfile:
    city, state, lat, lon = rng.choice(CITIES)
    avg = round(rng.uniform(25.0, 150.0), 2)
    return UserProfile(
        user_id=f"user_{index:03d}",
        home_city=city,
        home_state=state,
        home_latitude=lat,
        home_longitude=lon,
        avg_amount=avg,
        std_amount=round(avg * rng.uniform(0.2, 0.5), 2),
        typical_categories=rng.sample(TYPICAL_CATEGORY_POOL, rng.randint(3, 5)),
        active_hour_start=rng.randint(6, 10),
        active_hour_end=rng.randint(20, 23),
    )


def _legit_transaction(rng: random.Random, profile: UserProfile, day: datetime) -> Transaction:
    category = rng.choice(profile.typical_categories)
    timestamp = day.replace(
        hour=rng.randint(profile.active_hour_start, profile.active_hour_end),
        minute=rng.randint(0, 59),
        second=rng.randint(0, 59),
    )
    amount = max(1.0, rng.gauss(profile.avg_amount, profile.std_amount))
    return _local_txn(rng, profile, amount, rng.choice(MERCHANTS[category]), category, timestamp, False)


def _legit_history(
    rng: random.Random, profile: UserProfile, days: int, txns_per_day: float
) -> list[Transaction]:
    base = int(txns_per_day)
    extra_prob = txns_per_day - base
    history: list[Transaction] = []
    for d in range(days):
        day = START_DATE + timedelta(days=d)
        count = base + (1 if rng.random() < extra_prob else 0)
        history.extend(_legit_transaction(rng, profile, day) for _ in range(count))
    history.sort(key=lambda t: t.timestamp)
    return history


# --- Fraud patterns -----------------------------------------------------------
# Each pattern takes (rng, profile, episode_day, legit_history) and returns the
# injected transactions, all with is_fraud=True.


def _fraud_large_purchase(
    rng: random.Random, profile: UserProfile, day: datetime, history: list[Transaction]
) -> list[Transaction]:
    """One charge far above the user's normal spend in a high-risk category."""
    category = rng.choice([Category.ELECTRONICS, Category.JEWELRY])
    amount = max(profile.avg_amount * rng.uniform(8.0, 15.0), rng.uniform(900.0, 1500.0))
    timestamp = day.replace(
        hour=rng.randint(profile.active_hour_start, profile.active_hour_end),
        minute=rng.randint(0, 59),
        second=rng.randint(0, 59),
    )
    return [_local_txn(rng, profile, amount, rng.choice(MERCHANTS[category]), category, timestamp, True)]


def _fraud_card_testing(
    rng: random.Random, profile: UserProfile, day: datetime, history: list[Transaction]
) -> list[Transaction]:
    """3–5 small charges (under $12) inside a 30-minute window, overnight."""
    start = day.replace(hour=rng.randint(0, 4), minute=rng.randint(0, 29), second=0)
    count = rng.randint(3, 5)
    offsets = sorted(rng.sample(range(30 * 60), count))  # seconds, strictly < 30 min
    return [
        _local_txn(
            rng,
            profile,
            rng.uniform(0.50, 11.99),
            rng.choice(CARD_TESTING_MERCHANTS),
            Category.RETAIL,
            start + timedelta(seconds=offset),
            True,
        )
        for offset in offsets
    ]


def _fraud_geographic(
    rng: random.Random, profile: UserProfile, day: datetime, history: list[Transaction]
) -> list[Transaction]:
    """Charges 1,000+ miles from home within hours of a genuine local charge."""
    candidates = [t for t in history if t.timestamp >= day]
    if candidates:
        anchor = rng.choice(candidates)
    else:
        # No local charge to anchor on; inject a genuine one (is_fraud=False).
        anchor = _legit_transaction(rng, profile, day)
        history.append(anchor)

    far_cities = [
        c
        for c in CITIES
        if haversine_miles(profile.home_latitude, profile.home_longitude, c[2], c[3])
        >= GEO_MIN_DISTANCE_MILES
    ]
    city, state, lat, lon = rng.choice(far_cities)

    first = anchor.timestamp + timedelta(minutes=rng.randint(60, 240))
    count = rng.randint(1, 3)
    txns: list[Transaction] = []
    for i in range(count):
        category = rng.choice([Category.ELECTRONICS, Category.RETAIL, Category.RESTAURANTS, Category.TRAVEL])
        txns.append(
            _txn(
                profile,
                profile.avg_amount * rng.uniform(1.5, 4.0),
                rng.choice(MERCHANTS[category]),
                category,
                first + timedelta(minutes=i * rng.randint(5, 40)),
                city,
                state,
                lat + rng.uniform(-0.05, 0.05),
                lon + rng.uniform(-0.05, 0.05),
                True,
            )
        )
    return txns


def _fraud_gift_card_run(
    rng: random.Random, profile: UserProfile, day: datetime, history: list[Transaction]
) -> list[Transaction]:
    """3–5 round-dollar gift card purchases across different merchants within a few hours."""
    start = day.replace(
        hour=rng.randint(profile.active_hour_start, max(profile.active_hour_start, profile.active_hour_end - 3)),
        minute=rng.randint(0, 59),
        second=0,
    )
    count = rng.randint(3, 5)
    window_seconds = rng.randint(60, 180) * 60
    offsets = sorted(rng.sample(range(window_seconds), count))
    return [
        _local_txn(
            rng,
            profile,
            float(rng.choice([100, 150, 200, 250, 300, 500])),
            rng.choice(MERCHANTS[Category.GIFT_CARDS]),
            Category.GIFT_CARDS,
            start + timedelta(seconds=offset),
            True,
        )
        for offset in offsets
    ]


FRAUD_PATTERNS: list[FraudPattern] = [
    _fraud_large_purchase,
    _fraud_card_testing,
    _fraud_geographic,
    _fraud_gift_card_run,
]


def generate_dataset(
    n_users: int = 25,
    days: int = 90,
    txns_per_user_per_day: float = 2.5,
    fraud_user_rate: float = 0.30,
    seed: int = 42,
) -> tuple[list[UserProfile], list[Transaction]]:
    """Generate user profiles and a time-ordered transaction stream.

    A ``fraud_user_rate`` share of users each get exactly one injected fraud
    episode. Patterns are assigned round-robin over a seeded shuffle so all four
    appear whenever there are at least four fraud users.
    """
    if n_users < 0 or days < 3 or txns_per_user_per_day < 0 or not 0 <= fraud_user_rate <= 1:
        raise ValueError("invalid generate_dataset arguments")

    rng = random.Random(seed)
    profiles = [_make_profile(rng, i + 1) for i in range(n_users)]
    histories = {p.user_id: _legit_history(rng, p, days, txns_per_user_per_day) for p in profiles}

    fraud_users = rng.sample(profiles, round(n_users * fraud_user_rate))
    patterns = list(FRAUD_PATTERNS)
    rng.shuffle(patterns)

    injected: list[Transaction] = []
    for i, profile in enumerate(fraud_users):
        # Keep the first third of the window as clean history before any episode.
        day = START_DATE + timedelta(days=rng.randint(days // 3, days - 1))
        pattern = patterns[i % len(patterns)]
        injected.extend(pattern(rng, profile, day, histories[profile.user_id]))

    all_txns = [t for p in profiles for t in histories[p.user_id]] + injected
    all_txns.sort(key=lambda t: (t.timestamp, t.user_id, t.merchant, t.amount))
    transactions = [t.model_copy(update={"transaction_id": f"txn_{i:06d}"}) for i, t in enumerate(all_txns, 1)]
    return profiles, transactions
