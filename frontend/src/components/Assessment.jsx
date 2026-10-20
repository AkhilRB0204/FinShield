import { useId } from "react";

import ErrorNotice from "./ErrorNotice.jsx";
import Skeleton from "./Skeleton.jsx";
import { explanationSourceNote, formatPoints, riskFill, riskLevelLabel } from "../format.js";
import "./Assessment.css";

/**
 * The pieces of an assessment shared by the transaction detail page and the
 * analyze result: the score headline, and the indicator and explanation
 * columns. The score bar itself is `ScoreBar`.
 */

export function ScoreHeadline({ score, level, flagged }) {
  return (
    <div className="txn-score">
      <p className="txn-score-label">Risk score</p>
      <div className="txn-score-line">
        {/* Ink, not the level color: the swatch carries the color. */}
        <p className="txn-score-value">{formatPoints(score)}</p>
        <p className="txn-level">
          {level !== "low" && <span className="txn-level-swatch" style={{ background: riskFill(level) }} />}
          {riskLevelLabel(level)}
          <span className="txn-review">{flagged ? "Flagged for review" : "Below the review threshold"}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * Explanation first in source order, so it comes first when the columns stack;
 * on wide screens it sits on the right. `highlighted` is the index of the
 * segment hovered in the score bar.
 */
export function AssessmentColumns({ segments, notTriggered, highlighted, explanation, headingLevel = 2 }) {
  const id = useId();
  const H = `h${headingLevel}`;
  const Sub = `h${headingLevel + 1}`;
  return (
    <div className="txn-columns">
      <section className="txn-explanation" aria-labelledby={`${id}-explanation`}>
        <H id={`${id}-explanation`}>Explanation</H>
        <ExplanationPanel state={explanation} />
      </section>

      <section className="txn-indicators" aria-labelledby={`${id}-indicators`}>
        <H id={`${id}-indicators`}>Triggered indicators</H>
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

        <Sub className="quiet-heading">Checked and not triggered</Sub>
        {notTriggered.length === 0 ? (
          <p className="txn-quiet">Every indicator was triggered.</p>
        ) : (
          <ul className="not-triggered">
            {notTriggered.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** `state` is `{ status, data, error, retry }`; `data` carries explanation, action and source. */
function ExplanationPanel({ state }) {
  if (state.status === "loading") {
    return (
      <div className="explanation-skeleton" aria-busy="true">
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" width="60%" />
        <Skeleton height="3.5rem" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <ErrorNotice error={state.error} subject="The explanation" onRetry={state.retry} />
        <p className="txn-quiet">The score and its indicators are unaffected.</p>
      </>
    );
  }
  const { explanation, action, explanation_source: source } = state.data;
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

export function ColumnsSkeleton() {
  return (
    <div className="txn-columns" aria-hidden="true">
      <div className="explanation-skeleton txn-explanation">
        <Skeleton width="9rem" height="var(--text-h2)" />
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" width="60%" />
      </div>
      <div className="explanation-skeleton txn-indicators">
        <Skeleton width="12rem" height="var(--text-h2)" />
        <Skeleton width="70%" />
        <Skeleton />
        <Skeleton width="70%" />
        <Skeleton />
      </div>
    </div>
  );
}

export function ScoreSkeleton() {
  return (
    <div className="txn-score" aria-hidden="true">
      <Skeleton width="5rem" height="var(--text-sm)" />
      <div className="txn-score-line">
        <Skeleton width="10rem" height="var(--text-score)" />
        <Skeleton width="6rem" />
      </div>
    </div>
  );
}
