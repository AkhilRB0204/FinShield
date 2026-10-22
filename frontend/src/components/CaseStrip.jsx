import { Link } from "react-router";

import Skeleton from "./Skeleton.jsx";
import { formatMoney, formatPoints, riskLevelLabel, riskMark } from "../format.js";
import "./CaseStrip.css";

/**
 * A compact row of transactions, each linking to its detail page: merchant,
 * amount, score with its level, and the indicator that contributed most.
 * Each merchant link stretches over its whole case, so a case is one tab stop
 * and one click target. The path is built from the transaction id, encoded.
 */
export default function CaseStrip({ cases, label }) {
  return (
    <ul className="case-strip" aria-label={label}>
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
  );
}

export function CaseStripSkeleton({ count }) {
  return (
    <ul className="case-strip" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="case">
          <Skeleton width="8rem" />
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </li>
      ))}
    </ul>
  );
}
