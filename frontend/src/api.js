/**
 * FinShield API client. Every endpoint the backend exposes, and nothing else.
 *
 * Every failure throws an `ApiError` whose `kind` says what is known about it,
 * and nothing more:
 * - "timeout": no answer within the request's timeout. Why is not known.
 * - "network": no answer at all: the request never reached a server that
 *   replied (offline, DNS, CORS, the API not running), or no API address is
 *   configured.
 * - "http": the API answered with an error status, or with a body that is not
 *   JSON. Carries `status` and the server's `detail` string.
 *
 * A request the caller aborts rejects with the browser's AbortError, which is
 * not a failure and is not wrapped.
 */

const DEV_FALLBACK_URL = "http://localhost:8000";

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_URL;
  if (configured) return configured.replace(/\/+$/, "");
  // A production build never guesses a host: requests fail with a "network"
  // error instead, so the shell still renders and shows the problem.
  return import.meta.env.DEV ? DEV_FALLBACK_URL : null;
}

export const API_URL = resolveBaseUrl();

// Once, on load: the first thing to check when requests fail is where they went.
console.info(`[FinShield] API base URL: ${API_URL ?? "not configured (VITE_API_URL is unset)"}`);

export class ApiError extends Error {
  /** `kind` is "timeout", "network" or "http"; `status` and `detail` are set for "http". */
  constructor(kind, message, { status = null, detail = null, timeoutSeconds = null, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    // For "timeout": how long the request waited.
    this.timeoutSeconds = timeoutSeconds;
    // The address the request went to, or null when none is configured.
    this.baseUrl = API_URL;
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

// A free Render instance can take most of a minute to wake.
const TIMEOUT_MS = 60_000;

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

/** One signal that aborts when either does, keeping the reason of the one that fired. */
function eitherSignal(a, b) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const controller = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

async function send(path, { method = "GET", query, body, signal, timeoutMs = TIMEOUT_MS } = {}) {
  if (!API_URL) throw new ApiError("network", "No API address is configured: VITE_API_URL is unset.");
  const url = new URL(API_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  // The timeout covers reading the body too, since the same signal does.
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? eitherSignal(signal, timeout) : timeout;
  try {
    return await exchange(url, method, body, combined);
  } catch (err) {
    if (timeout.aborted && !signal?.aborted) {
      const timeoutSeconds = timeoutMs / 1000;
      throw new ApiError("timeout", `No response from ${url.origin} within ${timeoutSeconds} seconds.`, {
        timeoutSeconds,
        cause: err,
      });
    }
    throw err;
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
    if (signal.aborted) throw err; // A timeout or the caller's abort; `send` tells them apart.
    throw new ApiError("network", `Could not reach ${url.origin}.`, { cause: err });
  }

  let payload = null;
  let unreadable = null;
  try {
    payload = await response.json();
  } catch (err) {
    if (signal.aborted) throw err;
    unreadable = err;
  }

  if (!response.ok) {
    const detail = detailToString(payload?.detail, `Request failed with status ${response.status}.`);
    throw new ApiError("http", `${response.status}: ${detail}`, { status: response.status, detail });
  }
  if (unreadable) {
    const detail = "The response was not valid JSON.";
    throw new ApiError("http", `${response.status}: ${detail}`, { status: response.status, detail, cause: unreadable });
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
