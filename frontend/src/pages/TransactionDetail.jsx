import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { getTransaction } from "../api.js";
import Band from "../components/Band.jsx";
import ScoreBar, { scoreSegments } from "../components/ScoreBar.jsx";
import Skeleton from "../components/Skeleton.jsx";
import {
  explanationSourceNote,
  formatDateTime,
  formatMoney,
  formatPoints,
  riskFill,
  riskLevelLabel,
} from "../format.js";
import "./TransactionDetail.css";

/**
 * Fetches twice: once without the explanation, so the score and its bar render
 * without waiting on the model, and once with it. Scoring is deterministic, so
 * both responses carry the same assessment.
 */
function useTransaction(id) {
  const [scored, setScored] = useState({ status: "loading" });
  const [explained, setExplained] = useState({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setScored({ status: "loading" });
    setExplained({ status: "loading" });
    const settle = (set) => [
      (data) => set({ status: "ready", data }),
      (error) => error?.name !== "AbortError" && set({ status: "error", error }),
    ];
    getTransaction(id, { explanation: false, signal }).then(...settle(setScored));
    getTransaction(id, { signal }).then(...settle(setExplained));
    return () => controller.abort();
  }, [id]);

  // Whichever answer arrives first carries the assessment.
  const data = scored.data ?? explained.data;
  if (data) return { status: "ready", data, explained };
  if (scored.status === "error") return { status: "error", error: scored.error };
  return { status: "loading" };
}

export default function TransactionDetail() {
  const { id } = useParams();
  const result = useTransaction(id);

  if (result.status === "loading") return <DetailSkeleton />;
  if (result.status === "error") return <DetailError error={result.error} />;
  return <Detail txn={result.data} explained={result.explained} />;
}

function Detail({ txn, explained }) {
  const [highlighted, setHighlighted] = useState(null);
  const segments = useMemo(() => scoreSegments(txn.indicators, txn.breakdown), [txn]);

  return (
    <>
      <Band aria-labelledby="txn-title">
        <h1 id="txn-title" className="visually-hidden">
          Transaction at {txn.merchant}
        </h1>
        <div className="txn-summary">
          <div className="txn-score">
            <p className="txn-score-label">Risk score</p>
            <div className="txn-score-line">
              <p className="txn-score-value">{formatPoints(txn.risk_score)}</p>
              <p className="txn-level">
                {txn.risk_level !== "low" && (
                  <span className="txn-level-swatch" style={{ background: riskFill(txn.risk_level) }} />
                )}
                {riskLevelLabel(txn.risk_level)}
                <span className="txn-review">
                  {txn.flagged_for_review ? "Flagged for review" : "Below the review threshold"}
                </span>
              </p>
            </div>
          </div>
          <dl className="txn-fields">
            <Field label="Amount">{formatMoney(txn.amount)}</Field>
            <Field label="Category">{txn.category}</Field>
            <Field label="Merchant">{txn.merchant}</Field>
            <Field label="Location">
              {txn.city}, {txn.state}
            </Field>
            <Field label="Time">
              <time dateTime={txn.timestamp}>{formatDateTime(txn.timestamp)}</time>
            </Field>
          </dl>
        </div>
        <ScoreBar
          segments={segments}
          breakdown={txn.breakdown}
          level={txn.risk_level}
          onHighlight={setHighlighted}
        />
      </Band>

      <Band>
        <div className="txn-columns">
          {/* First in source order, so it comes first when the columns stack. */}
          <section className="txn-explanation" aria-labelledby="explanation-heading">
            <h2 id="explanation-heading">Explanation</h2>
            <Explanation explained={explained} />
          </section>

          <section className="txn-indicators" aria-labelledby="indicators-heading">
            <h2 id="indicators-heading">Triggered indicators</h2>
            {segments.length === 0 ? (
              <p className="txn-quiet">No indicators were triggered.</p>
            ) : (
              <ol className="indicator-list">
                {segments.map((segment, i) => (
                  <li key={i} className="indicator-row" data-highlighted={highlighted === i || undefined}>
                    <div className="indicator-head">
                      <span className="indicator-name">{segment.label}</span>
                      <span className="indicator-points">{formatPoints(segment.points)}</span>
                    </div>
                    <p className="indicator-detail">{segment.detail}</p>
                  </li>
                ))}
              </ol>
            )}

            <h3 className="quiet-heading">Checked and not triggered</h3>
            {txn.indicators_not_triggered.length === 0 ? (
              <p className="txn-quiet">Every indicator was triggered.</p>
            ) : (
              <ul className="not-triggered">
                {txn.indicators_not_triggered.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Band>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Explanation({ explained }) {
  if (explained.status === "loading") {
    return (
      <div className="explanation-skeleton" aria-busy="true">
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" width="60%" />
        <Skeleton height="3.5rem" />
      </div>
    );
  }
  if (explained.status === "error") {
    return (
      <p className="txn-quiet">
        The explanation could not be loaded. {explained.error.detail} The score and its indicators
        are unaffected.
      </p>
    );
  }
  const { explanation, action, explanation_source: source } = explained.data;
  return (
    <>
      {/* Model output: rendered as text only, never as HTML or Markdown. */}
      <p className="explanation-prose">{explanation}</p>
      <div className="action-band">
        <p className="action-label">Recommended action</p>
        <p className="action-text">{action}</p>
      </div>
      <p className="explanation-source">{explanationSourceNote(source)}</p>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <Band aria-busy="true" aria-label="Loading transaction">
        <div className="txn-summary">
          <Skeleton width="10rem" height="var(--text-score)" />
          <div className="explanation-skeleton" style={{ flex: "1 1 20rem" }}>
            <Skeleton width="80%" />
            <Skeleton width="50%" />
          </div>
        </div>
        <Skeleton height="var(--score-bar-height)" />
      </Band>
      <Band aria-hidden="true">
        <div className="txn-columns">
          <div className="explanation-skeleton txn-explanation">
            <Skeleton height="1.1em" />
            <Skeleton height="1.1em" />
            <Skeleton height="1.1em" width="60%" />
          </div>
          <div className="explanation-skeleton txn-indicators">
            <Skeleton width="70%" />
            <Skeleton />
            <Skeleton width="70%" />
            <Skeleton />
          </div>
        </div>
      </Band>
    </>
  );
}

function DetailError({ error }) {
  if (error.status === 404) {
    return (
      <Band>
        <h1>Transaction not found</h1>
        <p>
          There is no transaction at this address. <Link to="/transactions">Go to transactions</Link>
        </p>
      </Band>
    );
  }
  return (
    <Band>
      <h1>Transaction unavailable</h1>
      <p>The transaction could not be loaded. {error.detail}</p>
    </Band>
  );
}
