/** Display formatting. API values are never shown raw when they are identifiers. */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(amount) {
  return money.format(amount);
}

/** "user_009" → "Customer 009". User ids are identifiers and never shown as-is. */
export function customerLabel(userId) {
  const match = /^user_(\w+)$/.exec(userId);
  return match ? `Customer ${match[1]}` : "Customer";
}

const RISK_LEVEL_LABELS = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

/** Fixed lookup: `risk_level` arrives lowercase and is mapped, never echoed. */
export function riskLevelLabel(level) {
  return RISK_LEVEL_LABELS[level] ?? "Unknown";
}

/** Scores and points: one decimal place, never rounded further. */
export function formatPoints(points) {
  return points.toFixed(1);
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(iso) {
  return dateTime.format(new Date(iso));
}

// Fixed lookup, so no CSS value is ever built from API text. Low risk has no
// color: its marks are slate.
const RISK_FILLS = {
  critical: "var(--risk-critical)",
  high: "var(--risk-high)",
  medium: "var(--risk-medium)",
  low: "var(--score-bar-low)",
};

export function riskFill(level) {
  return RISK_FILLS[level] ?? RISK_FILLS.low;
}

const EXPLANATION_SOURCES = {
  model: "Written by Claude from the indicators listed. Claude explains the score; it did not set it.",
  no_api_key: "Assembled from the detector output, because no Anthropic API key is configured.",
  no_indicators:
    "Assembled from the detector output. No indicators were triggered, so there was nothing for Claude to explain.",
  model_unavailable: "Assembled from the detector output, because Claude could not be reached.",
};

/** Fixed lookup: `explanation_source` arrives as an enum value and is never shown raw. */
export function explanationSourceNote(source) {
  return EXPLANATION_SOURCES[source] ?? EXPLANATION_SOURCES.model_unavailable;
}
