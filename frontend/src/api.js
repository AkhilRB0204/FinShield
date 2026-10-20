/**
 * FinShield API client. Every endpoint the backend exposes, and nothing else.
 *
 * Failures throw typed errors so callers can branch on them:
 * - ApiError: the server answered with a non-2xx status. Carries `status` and
 *   the server's `detail` string.
 * - NetworkError: no usable answer (offline, DNS, CORS, or a non-JSON body).
 *   A subclass of ApiError with `status` 0.
 */

const DEV_FALLBACK_URL = "http://localhost:8000";

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_URL;
  if (configured) return configured.replace(/\/+$/, "");
  // A production build never guesses a host: requests fail with a NetworkError
  // instead, so the shell still renders and shows the problem.
  return import.meta.env.DEV ? DEV_FALLBACK_URL : null;
}

export const API_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class NetworkError extends ApiError {
  /** `reason` is "unconfigured", "unreachable" or "unreadable". */
  constructor(detail, reason, cause) {
    super(0, detail);
    this.name = "NetworkError";
    this.reason = reason;
    this.cause = cause;
  }
}

// FastAPI sends `detail` as a string for HTTPException and as a list of
// {loc, msg} objects for validation errors. Callers always get one string.
function detailToString(detail, fallback) {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((d) => (d && typeof d.msg === "string" ? d.msg : null)).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return fallback;
}

async function request(path, { method = "GET", query, body, signal } = {}) {
  if (!API_URL) throw new NetworkError("This build is not configured with an API address.", "unconfigured");
  const url = new URL(API_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new NetworkError("The FinShield service could not be reached.", "unreachable", err);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    if (response.ok) {
      throw new NetworkError("The FinShield service sent an unreadable response.", "unreadable", err);
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      detailToString(payload?.detail, `Request failed with status ${response.status}.`),
    );
  }
  return payload;
}

// --- Endpoints ------------------------------------------------------------------

export function getHealth({ signal } = {}) {
  return request("/health", { signal });
}

/** Score a transaction. `explanation: false` skips the plain-English explanation. */
export function analyzeTransaction(transaction, { explanation = true, signal } = {}) {
  return request("/analyze", { method: "POST", body: transaction, query: { explanation }, signal });
}

/** Category and city choices for the analyze form. */
export function getReference({ signal } = {}) {
  return request("/reference", { signal });
}

export function listUsers({ signal } = {}) {
  return request("/users", { signal });
}

/** Transactions newest first. */
export function listTransactions({ userId, flaggedOnly, limit, signal } = {}) {
  return request("/transactions", {
    query: { user_id: userId, flagged_only: flaggedOnly, limit },
    signal,
  });
}

/** One transaction with its score breakdown. `explanation: false` skips the explanation. */
export function getTransaction(transactionId, { explanation = true, signal } = {}) {
  return request(`/transactions/${encodeURIComponent(transactionId)}`, {
    query: { explanation },
    signal,
  });
}

export function getStats({ signal } = {}) {
  return request("/stats", { signal });
}
