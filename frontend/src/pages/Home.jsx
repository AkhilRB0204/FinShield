import { Link } from "react-router";

import { listTransactions } from "../api.js";
import Band from "../components/Band.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { formatMoney, formatPoints, riskLevelLabel, riskMark } from "../format.js";
import { useApi } from "../useApi.js";
import { DetailSkeleton, TransactionAssessment } from "./TransactionDetail.jsx";
import "./Home.css";

// Enough flagged transactions to find three with different top indicators.
const CANDIDATES = 100;
const MORE_CASES = 3;

/**
 * The demonstration: the highest-scoring transaction in the dataset, in full,
 * then a few more flagged ones. The demonstration is the pitch, so there is
 * nothing else on the page.
 */
export default function Home() {
  const flagged = useApi(
    (signal) => listTransactions({ flaggedOnly: true, order: "risk", limit: CANDIDATES, signal }),
    [],
  );

  return (
    <>
      <Band as="header">
        <h1 className="home-statement">
          Fraud detection that shows you why. Every risk score breaks into named reasons you can check.
        </h1>
      </Band>
      <Demonstration flagged={flagged} />
    </>
  );
}

function Demonstration({ flagged }) {
  if (flagged.status === "error") {
    return (
      <Band>
        <ErrorNotice error={flagged.error} subject="The demonstration" onRetry={flagged.retry} />
      </Band>
    );
  }
  if (flagged.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading demonstration">
        <DetailSkeleton />
        <TryBand />
        <CasesSkeleton />
      </div>
    );
  }
  if (flagged.data.length === 0) {
    return (
      <>
        <Band>
          <p>No transaction in the demo dataset is flagged for review, so there is nothing to demonstrate yet.</p>
        </Band>
        <TryBand />
      </>
    );
  }

  const [hero, ...rest] = flagged.data;
  const others = pickVaried(rest, hero, MORE_CASES);
  return (
    <>
      <TransactionAssessment
        id={hero.transaction_id}
        headingLevel={2}
        caption="The highest risk score in the demo dataset"
      />
      <TryBand />
      {others.length > 0 && <Cases cases={others} />}
    </>
  );
}

/**
 * Up to `count` of `rows` (highest score first), preferring a different top
 * indicator for each, so the strip shows different cases rather than three of
 * the same. Keeps the score order.
 */
function pickVaried(rows, hero, count) {
  const seen = new Set([hero.top_indicator]);
  const picked = new Set();
  for (const row of rows) {
    if (picked.size === count) break;
    if (seen.has(row.top_indicator)) continue;
    seen.add(row.top_indicator);
    picked.add(row);
  }
  for (const row of rows) {
    if (picked.size === count) break;
    picked.add(row);
  }
  return rows.filter((row) => picked.has(row));
}

function TryBand() {
  return (
    <Band>
      <p className="home-try">
        <Link to="/analyze">
          Score your own transaction <span aria-hidden="true">→</span>
        </Link>
      </p>
    </Band>
  );
}

/**
 * Each merchant link stretches over its whole case, so a case is one tab stop
 * and one click target. The path is built from the transaction id, encoded.
 */
function Cases({ cases }) {
  return (
    <Band aria-labelledby="cases-heading">
      <h2 id="cases-heading" className="quiet-heading">
        More flagged transactions
      </h2>
      <ul className="case-strip">
        {cases.map((txn) => (
          <li key={txn.transaction_id} className="case" style={{ "--row-mark": riskMark(txn.risk_level) }}>
            <Link className="case-link" to={`/txn/${encodeURIComponent(txn.transaction_id)}`}>
              {txn.merchant}
            </Link>
            <dl className="case-fields">
              <div>
                <dt>Amount</dt>
                <dd>{formatMoney(txn.amount)}</dd>
              </div>
              <div>
                <dt>Risk score</dt>
                <dd>
                  {formatPoints(txn.risk_score)} <span className="case-level">{riskLevelLabel(txn.risk_level)}</span>
                </dd>
              </div>
              <div className="case-top">
                <dt>Top indicator</dt>
                <dd>{txn.top_indicator ?? "None"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Band>
  );
}

function CasesSkeleton() {
  return (
    <Band aria-hidden="true">
      <Skeleton width="11rem" />
      <ul className="case-strip">
        {Array.from({ length: MORE_CASES }, (_, i) => (
          <li key={i} className="case">
            <Skeleton width="8rem" />
            <Skeleton width="70%" />
            <Skeleton width="50%" />
          </li>
        ))}
      </ul>
    </Band>
  );
}
