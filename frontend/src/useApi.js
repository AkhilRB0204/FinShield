import { useCallback, useEffect, useState } from "react";

/**
 * Runs `load(signal)` when `deps` change and tracks its state. `retry` runs it
 * again. Superseded requests are aborted, so a stale answer never lands.
 */
export function useApi(load, deps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      (error) => error?.name !== "AbortError" && setState({ status: "error", error }),
    );
    return () => controller.abort();
    // `load` is a fresh closure every render; `deps` says when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
