import "./ErrorNotice.css";

/**
 * The one way a failed request is shown. `subject` and `verb` complete
 * "… could not be loaded" ("The transactions", "loaded"). A server that cannot
 * be reached is usually the free Render instance waking up, so that case says so
 * and offers a retry.
 */
export default function ErrorNotice({ error, subject, verb = "loaded", onRetry }) {
  let message;
  if (error?.reason === "unconfigured") {
    message = "This build is not configured with an API address, so nothing can be loaded.";
  } else if (error?.reason === "unreachable") {
    message =
      `${subject} could not be ${verb} because the FinShield service did not respond. ` +
      "It runs on a free Render instance, which sleeps after 15 minutes without traffic " +
      "and takes up to a minute to wake. Try again shortly.";
  } else {
    message = `${subject} could not be ${verb}. ${error?.detail ?? ""}`.trim();
  }

  return (
    <div className="error-notice" role="alert">
      <p>{message}</p>
      {onRetry && error?.reason !== "unconfigured" && (
        <button type="button" className="button-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
