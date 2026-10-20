import { lazy, Suspense, useMemo } from "react";

import { getStats } from "../api.js";
import Band from "../components/Band.jsx";
import { BarLabels, useBarLabels } from "../components/BarLabels.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { formatCount, formatMoney, formatRate, riskFill, riskLevelLabel } from "../format.js";
import { useApi } from "../useApi.js";
import "../components/DataTable.css";
import "./Dashboard.css";

// Most severe first, like the score bar. Low comes last and has no fill.
const LEVELS = ["critical", "high", "medium", "low"];
// px. A level with a handful of transactions out of thousands would otherwise be
// a sliver too thin to see; its label always carries the exact count.
const MIN_SEGMENT_PX = 6;

// Recharts is the largest dependency and only this page uses it.
const IndicatorChart = lazy(() => import("../components/IndicatorChart.jsx"));

export default function Dashboard() {
  const stats = useApi((signal) => getStats({ signal }), []);

  return (
    <>
      <Band>
        <h1>Dashboard</h1>
        {stats.status === "error" && (
          <ErrorNotice error={stats.error} subject="The dashboard figures" onRetry={stats.retry} />
        )}
        {stats.status === "ready" && stats.data.total_transactions === 0 && (
          <p>No transactions have been scored yet, so there is nothing to summarize.</p>
        )}
      </Band>
      {stats.status === "loading" && <DashboardSkeleton />}
      {stats.status === "ready" && stats.data.total_transactions > 0 && <DashboardBody stats={stats.data} />}
    </>
  );
}

function DashboardBody({ stats }) {
  return (
    <>
      <Band aria-label="Summary">
        <dl className="stat-band">
          <Stat label="Transactions">{formatCount(stats.total_transactions)}</Stat>
          <Stat label="Total spend">{formatMoney(stats.total_amount)}</Stat>
          <Stat label="Customers">{formatCount(stats.total_customers)}</Stat>
          <Stat label="Flagged for review">{formatCount(stats.flagged_for_review)}</Stat>
          <Stat label="Flagged rate">{formatRate(stats.flagged_rate)}</Stat>
        </dl>
      </Band>

      <Band aria-labelledby="distribution-heading">
        <h2 id="distribution-heading">Risk distribution</h2>
        <RiskDistribution levels={stats.risk_levels} total={stats.total_transactions} />
      </Band>

      <Band aria-labelledby="indicators-heading">
        <h2 id="indicators-heading">Indicators triggered</h2>
        {stats.indicators_triggered.length === 0 ? (
          <p className="txn-quiet">No indicators have been triggered by any transaction.</p>
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            <IndicatorChart indicators={stats.indicators_triggered} />
          </Suspense>
        )}
      </Band>

      <Band aria-labelledby="spend-heading">
        <h2 id="spend-heading">Spend by category</h2>
        <SpendTable categories={stats.by_category} />
      </Band>
    </>
  );
}

function Stat({ label, children }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One stacked bar of all transactions by risk level. Critical, high and medium
 * are filled in their risk colors; low is the remaining paper track, because
 * low risk has no color. Not animated: the score bar is the app's only motion.
 */
function RiskDistribution({ levels, total }) {
  const segments = useMemo(
    () =>
      LEVELS.filter((level) => levels[level] > 0).map((level) => ({
        level,
        count: levels[level],
        width: levels[level] / total,
      })),
    [levels, total],
  );
  const labels = useBarLabels(segments, MIN_SEGMENT_PX);
  const empty = LEVELS.filter((level) => levels[level] === 0);

  return (
    <div className="distribution">
      <div className="distribution-visual" aria-hidden="true">
        <div className="distribution-track" ref={labels.trackRef}>
          {segments
            .filter((segment) => segment.level !== "low")
            .map((segment) => (
              <div
                key={segment.level}
                className="distribution-segment"
                style={{ flexBasis: `${segment.width * 100}%`, background: riskFill(segment.level) }}
              />
            ))}
        </div>
        <BarLabels
          items={segments}
          labels={labels}
          renderLabel={(segment) => (
            <>
              {riskLevelLabel(segment.level)} <span className="bar-label-figure">{formatCount(segment.count)}</span>
            </>
          )}
        />
      </div>
      {empty.length > 0 && (
        <p className="distribution-note">
          No transactions at {empty.map((level) => riskLevelLabel(level)).join(", ")} risk.
        </p>
      )}
      <ul className="visually-hidden">
        {LEVELS.map((level) => (
          <li key={level}>
            {riskLevelLabel(level)}: {formatCount(levels[level])} of {formatCount(total)} transactions
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="chart-skeleton" aria-hidden="true">
      {["90%", "70%", "55%", "40%", "30%", "20%", "12%"].map((width, i) => (
        <Skeleton key={i} width={width} height="1.75rem" />
      ))}
    </div>
  );
}

function SpendTable({ categories }) {
  return (
    <table className="data-table spend-table">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Transactions</th>
          <th scope="col">Total spend</th>
        </tr>
      </thead>
      <tbody>
        {categories.map((row) => (
          <tr key={row.category}>
            <td>{row.category}</td>
            <td>{formatCount(row.count)}</td>
            <td>{formatMoney(row.total_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Band aria-hidden="true">
        <div className="stat-band">
          {["5rem", "8rem", "3rem", "3rem", "5rem"].map((width, i) => (
            <div key={i} className="stat">
              <Skeleton width="6rem" height="var(--text-sm)" />
              <Skeleton width={width} height="var(--text-h1)" />
            </div>
          ))}
        </div>
      </Band>
      <Band aria-hidden="true">
        <Skeleton width="10rem" height="var(--text-h2)" />
        <Skeleton height="calc(var(--score-bar-height) + 3rem)" />
      </Band>
      <Band aria-hidden="true">
        <Skeleton width="12rem" height="var(--text-h2)" />
        <ChartSkeleton />
      </Band>
      <Band aria-hidden="true">
        <Skeleton width="11rem" height="var(--text-h2)" />
        <table className="data-table spend-table">
          <tbody>
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                <td><Skeleton width="7rem" /></td>
                <td><Skeleton width="3rem" /></td>
                <td><Skeleton width="5rem" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Band>
    </div>
  );
}
