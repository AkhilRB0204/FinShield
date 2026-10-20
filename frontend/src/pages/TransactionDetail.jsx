import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { getTransaction } from "../api.js";
import { AssessmentColumns, ColumnsSkeleton, ScoreHeadline, ScoreSkeleton } from "../components/Assessment.jsx";
import Band from "../components/Band.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import ScoreBar, { scoreSegments } from "../components/ScoreBar.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { formatDateTime, formatMoney } from "../format.js";
import { useApi } from "../useApi.js";
import "./TransactionDetail.css";

export default function TransactionDetail() {
  const { id } = useParams();
  // Two requests: without the explanation, so the score and its bar render
  // without waiting on the model, and with it. Scoring is deterministic, so both
  // carry the same assessment.
  const scored = useApi((signal) => getTransaction(id, { explanation: false, signal }), [id]);
  const explained = useApi((signal) => getTransaction(id, { signal }), [id]);

  const txn = scored.data ?? explained.data;
  if (txn) return <Detail txn={txn} explained={explained} />;
  if (scored.status === "error") return <DetailError error={scored.error} onRetry={scored.retry} />;
  return <DetailSkeleton />;
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
          <ScoreHeadline score={txn.risk_score} level={txn.risk_level} flagged={txn.flagged_for_review} />
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
        <ScoreBar segments={segments} breakdown={txn.breakdown} level={txn.risk_level} onHighlight={setHighlighted} />
      </Band>

      <Band>
        <AssessmentColumns
          segments={segments}
          notTriggered={txn.indicators_not_triggered}
          highlighted={highlighted}
          explanation={explained}
        />
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

function DetailSkeleton() {
  return (
    <>
      <Band aria-busy="true" aria-label="Loading transaction">
        <div className="txn-summary">
          <ScoreSkeleton />
          <div className="txn-fields" aria-hidden="true">
            {["4rem", "6rem", "7rem", "6rem", "9rem"].map((width, i) => (
              <div key={i} className="explanation-skeleton">
                <Skeleton width="3.5rem" height="var(--text-sm)" />
                <Skeleton width={width} />
              </div>
            ))}
          </div>
        </div>
        <Skeleton height="calc(var(--score-bar-height) + 3.5rem)" />
      </Band>
      <Band aria-hidden="true">
        <ColumnsSkeleton />
      </Band>
    </>
  );
}

function DetailError({ error, onRetry }) {
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
      <ErrorNotice error={error} subject="The transaction" onRetry={onRetry} />
    </Band>
  );
}
