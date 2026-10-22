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

// --- Requests in flight ---------------------------------------------------------
//
// A free Render instance can take up to a minute to wake, so the shell watches
// how long requests have been outstanding and says so (see `WakingNotice`).

const inFlight = new Set();
const inFlightListeners = new Set();

/** Calls `listener(count)` whenever the number of requests in flight changes. */
export function subscribeInFlight(listener) {
  inFlightListeners.add(listener);
  listener(inFlight.size);
  return () => inFlightListeners.delete(listener);
}

function track(token, active) {
  if (active) inFlight.add(token);
  else inFlight.delete(token);
  for (const listener of inFlightListeners) listener(inFlight.size);
}

// Longer than a Render wake-up, so only a server that is down or hung times out.
const TIMEOUT_MS = 75_000;

/**
 * `untracked` leaves a request out of the in-flight count: one that is slow
 * because of the work it asks for, not because the server is waking.
 */
async function request(path, { untracked = false, ...options } = {}) {
  if (untracked) return send(path, options);
  const token = {};
  track(token, true);
  try {
    return await send(path, options);
  } finally {
    track(token, false);
  }
}

async function send(path, { method = "GET", query, body, signal, timeoutMs = TIMEOUT_MS } = {}) {
  if (!API_URL) throw new NetworkError("This build is not configured with an API address.", "unconfigured");
  const url = new URL(API_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  // One signal for both the caller's abort and the timeout, covering the body too.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  try {
    return await exchange(url, method, body, controller.signal);
  } catch (err) {
    if (err?.name === "AbortError" && timedOut) {
      throw new NetworkError("The FinShield service did not respond in time.", "unreachable", err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function exchange(url, method, body, signal) {
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
    if (err?.name === "AbortError") throw err;
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

/**
 * Screen a message's raw text with the message rules. Answers in the same shape
 * as `analyzeTransaction`. `explanation: false` skips the explanation.
 */
export function analyzeMessage(text, { explanation = true, signal } = {}) {
  return request("/analyze-message", { method: "POST", body: { text }, query: { explanation }, signal });
}

/** Category and city choices for the analyze form. */
export function getReference({ signal } = {}) {
  return request("/reference", { signal });
}

export function listUsers({ signal } = {}) {
  return request("/users", { signal });
}

/** Transactions newest first, or highest risk score first with `order: "risk"`. */
export function listTransactions({ userId, flaggedOnly, limit, order, signal } = {}) {
  return request("/transactions", {
    query: { user_id: userId, flagged_only: flaggedOnly, limit, order },
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

// A question can take several model turns, each with lookups.
const ASK_TIMEOUT_MS = 150_000;

/** Answer a question about the dataset from lookups only. */
export function askQuestion(question, { signal } = {}) {
  return request("/ask", {
    method: "POST",
    body: { question },
    signal,
    timeoutMs: ASK_TIMEOUT_MS,
    untracked: true,
  });
}
