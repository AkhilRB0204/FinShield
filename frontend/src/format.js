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
