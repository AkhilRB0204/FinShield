import { useId } from "react";
import { Link, useSearchParams } from "react-router";

import { listTransactions } from "../api.js";
import Band from "../components/Band.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import Skeleton from "../components/Skeleton.jsx";
import {
  customerLabel,
  formatCount,
  formatDateTime,
  formatMoney,
  formatPoints,
  riskLevelLabel,
  riskMark,
} from "../format.js";
import { useApi } from "../useApi.js";
import AskPanel from "./AskPanel.jsx";
import "../components/Assessment.css";
import "../components/DataTable.css";
import "./Transactions.css";

const LIMITS = [50, 100, 250, 500, 1000];
const DEFAULT_LIMIT = 100;
const SKELETON_ROWS = 12;

/** Filters live in the URL, so they survive going to a transaction and back. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("limit"));
  const filters = {
    flaggedOnly: params.get("flagged") === "1",
    limit: LIMITS.includes(requested) ? requested : DEFAULT_LIMIT,
  };
  const update = (next) => {
    const merged = { ...filters, ...next };
    const query = new URLSearchParams();
    if (merged.flaggedOnly) query.set("flagged", "1");
    if (merged.limit !== DEFAULT_LIMIT) query.set("limit", String(merged.limit));
    setParams(query, { replace: true });
  };
  return [filters, update];
}

export default function Transactions() {
  const [{ flaggedOnly, limit }, setFilters] = useFilters();
  const result = useApi(
    (signal) => listTransactions({ flaggedOnly, limit, signal }),
    [flaggedOnly, limit],
  );
  const limitId = useId();

  return (
    <>
      <Band>
        <h1>Transactions</h1>
        <AskPanel />
      </Band>

      <Band aria-label="Filters">
        <div className="table-filters" role="group" aria-label="Filter transactions">
          <label className="control-check">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(event) => setFilters({ flaggedOnly: event.target.checked })}
            />
            Flagged for review only
          </label>
          <div className="table-filter-limit">
            <label htmlFor={limitId}>Show</label>
            <select
              id={limitId}
              className="control-select"
              value={limit}
              onChange={(event) => setFilters({ limit: Number(event.target.value) })}
            >
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  {formatCount(n)} most recent
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="table-count" aria-live="polite">
          {result.status === "ready" && countLine(result.data.length, { flaggedOnly, limit })}
        </p>
      </Band>

      <Band aria-label="Transaction list">
        {/* The layout responds to this box's width, not the viewport's: beside the
            rail, a 768px screen leaves the table under 500px. */}
        <div className="txn-list">
          <Body result={result} flaggedOnly={flaggedOnly} onShowAll={() => setFilters({ flaggedOnly: false })} />
        </div>
      </Band>
    </>
  );
}

function countLine(count, { flaggedOnly, limit }) {
  if (count === 0) return "";
  if (flaggedOnly) {
    return count < limit
      ? `${formatCount(count)} transactions flagged for review, newest first.`
      : `The ${formatCount(count)} most recent transactions flagged for review.`;
  }
  return count < limit
    ? `All ${formatCount(count)} transactions, newest first.`
    : `The ${formatCount(count)} most recent transactions.`;
}

function Body({ result, flaggedOnly, onShowAll }) {
  if (result.status === "error") {
    return <ErrorNotice error={result.error} subject="The transactions" onRetry={result.retry} />;
  }
  if (result.status === "ready" && result.data.length === 0) {
    return flaggedOnly ? (
      <div className="empty-state">
        <p>No transactions are flagged for review. Every scored transaction is below the review threshold.</p>
        <button type="button" className="button-secondary" onClick={onShowAll}>
          Show all transactions
        </button>
      </div>
    ) : (
      <p className="empty-state">No transactions have been scored yet.</p>
    );
  }

  const loading = result.status === "loading";
  // Explicit roles: the two-line layout on narrow screens restyles rows as
  // grids, which makes some browsers drop the implicit table semantics.
  return (
    <table role="table" className="data-table txn-table" aria-busy={loading || undefined}>
      <caption className="visually-hidden">Transactions, newest first. Open a row to see its full assessment.</caption>
      <thead role="rowgroup">
        <tr role="row">
          {[
            ["col-time", "Time"],
            ["col-customer", "Customer"],
            ["col-merchant", "Merchant"],
            ["col-category", "Category"],
            ["col-location", "Location"],
            ["col-amount", "Amount"],
            ["col-score", "Risk score"],
            ["col-level", "Level"],
          ].map(([className, label]) => (
            <th key={className} role="columnheader" scope="col" className={className}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => <SkeletonRow key={i} />)
          : result.data.map((txn) => <Row key={txn.transaction_id} txn={txn} />)}
      </tbody>
    </table>
  );
}

/**
 * The merchant link stretches over the whole row, so the row is one tab stop
 * and one click target, and the focus ring is drawn around the row. The path is
 * built from the transaction id, encoded; nothing else from the API reaches a URL.
 */
function Row({ txn }) {
  return (
    <tr role="row" className="txn-row" style={{ "--row-mark": riskMark(txn.risk_level) }}>
      <td role="cell" className="col-time">
        <time dateTime={txn.timestamp}>{formatDateTime(txn.timestamp)}</time>
      </td>
      <td role="cell" className="col-customer">{customerLabel(txn.user_id)}</td>
      <td role="cell" className="col-merchant">
        <Link className="row-link" to={`/txn/${encodeURIComponent(txn.transaction_id)}`}>
          {txn.merchant}
        </Link>
      </td>
      <td role="cell" className="col-category">{txn.category}</td>
      <td role="cell" className="col-location">
        {txn.city}, {txn.state}
      </td>
      <td role="cell" className="col-amount">{formatMoney(txn.amount)}</td>
      <td role="cell" className="col-score">{formatPoints(txn.risk_score)}</td>
      <td role="cell" className="col-level">{riskLevelLabel(txn.risk_level)}</td>
    </tr>
  );
}

function SkeletonRow() {
  return (
    <tr className="txn-row" aria-hidden="true">
      <td className="col-time"><Skeleton width="8.5rem" /></td>
      <td className="col-customer"><Skeleton width="6rem" /></td>
      <td className="col-merchant"><Skeleton width="7rem" /></td>
      <td className="col-category"><Skeleton width="5.5rem" /></td>
      <td className="col-location"><Skeleton width="6.5rem" /></td>
      <td className="col-amount"><Skeleton width="4rem" /></td>
      <td className="col-score"><Skeleton width="2.5rem" /></td>
      <td className="col-level"><Skeleton width="3.5rem" /></td>
    </tr>
  );
}
