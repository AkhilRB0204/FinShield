import { useEffect, useState } from "react";

import { subscribeInFlight } from "../api.js";
import "./WakingNotice.css";

// Long enough that an awake server never triggers it.
const DELAY_MS = 5000;

/**
 * Shown once any request has been outstanding for a few seconds, so a sleeping
 * Render instance reads as "waking up" rather than as a page that never loads.
 * The live region is always mounted, so the message is announced when it appears.
 */
export default function WakingNotice() {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribeInFlight((count) => {
      if (count > 0 && timer === null) {
        timer = setTimeout(() => setWaiting(true), DELAY_MS);
      } else if (count === 0) {
        clearTimeout(timer);
        timer = null;
        setWaiting(false);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div role="status" className="waking-notice-region">
      {waiting && (
        <p className="waking-notice">
          Waiting for the FinShield service. It runs on a free Render instance, which sleeps after 15 minutes
          without traffic and takes up to a minute to wake.
        </p>
      )}
    </div>
  );
}
