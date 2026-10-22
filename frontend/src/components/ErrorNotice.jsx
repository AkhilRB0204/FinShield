import "./ErrorNotice.css";

/**
 * The one way a failed request is shown. `subject` and `verb` complete
 * "… could not be loaded" ("The transactions", "loaded").
 *
 * Each message says only what the error establishes. A timeout means no
 * answer arrived in time, not that the service was asleep; a network failure
 * means no server answered at the configured address, not why. Never name a
 * cause the error does not carry.
 *
 * `compact` renders one line and a retry button, for narrow places such as the
 * 220px rail.
 */
export default function ErrorNotice({ error, subject, verb = "loaded", onRetry, compact = false }) {
  const unconfigured = error?.kind === "network" && !error.baseUrl;
  const retry = onRetry && !unconfigured && (
    <button type="button" className="button-secondary" onClick={onRetry}>
      Try again
    </button>
  );

  if (compact) {
    return (
      <div className="error-notice error-notice-compact" role="alert">
        <p>
          <span className="visually-hidden">{subject} could not be {verb}. </span>
          {shortMessage(error)}
        </p>
        {retry}
      </div>
    );
  }

  return (
    <div className="error-notice" role="alert">
      <p>
        {subject} could not be {verb}. {fullMessage(error)}
      </p>
      {retry}
    </div>
  );
}

function fullMessage(error) {
  switch (error?.kind) {
    case "timeout":
      return (
        `The API did not respond within ${error.timeoutSeconds ?? 60} seconds. If it is hosted on ` +
        "Render's free tier, it may have been asleep: an idle instance sleeps after 15 minutes " +
        "and can take up to a minute to wake. Try again shortly."
      );
    case "network":
      return error.baseUrl
        ? `Couldn't reach the API at ${error.baseUrl}. Check that VITE_API_URL is set and the backend is running.`
        : "Couldn't reach the API: no API address is configured. Check that VITE_API_URL is set and the backend is running.";
    case "http":
      return `The API answered with status ${error.status}: ${error.detail}`;
    default:
      // Not a request failure, so there is nothing known to report beyond the message.
      return error?.message ? `Unexpected error: ${error.message}` : "Unexpected error.";
  }
}

function shortMessage(error) {
  switch (error?.kind) {
    case "timeout":
      return "The API did not respond in time.";
    case "network":
      return error.baseUrl ? "Couldn't reach the API." : "No API address is configured.";
    case "http":
      return `The API answered with status ${error.status}.`;
    default:
      return "Unexpected error.";
  }
}
