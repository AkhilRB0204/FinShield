import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { formatCount } from "../format.js";
import "./IndicatorChart.css";

const ROW_PX = 36;

/**
 * Transactions per triggered indicator. Its own module so Recharts loads only
 * with the dashboard.
 *
 * One series, so one color and no legend; every bar is labelled with its count,
 * so nothing depends on hover. Slate, not a risk color: a count of triggers is
 * not a severity. Not animated: the score bar is the app's only motion.
 */
export default function IndicatorChart({ indicators }) {
  return (
    <>
      <div className="indicator-chart" aria-hidden="true" style={{ height: indicators.length * ROW_PX + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={indicators}
            layout="vertical"
            margin={{ top: 0, right: 48, bottom: 0, left: 0 }}
            barCategoryGap={8}
            accessibilityLayer={false}
          >
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "currentColor" }} />
            <YAxis
              type="category"
              dataKey="indicator"
              width={140}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "currentColor" }}
            />
            <Bar dataKey="count" fill="currentColor" isAnimationActive={false} className="indicator-chart-bar">
              <LabelList dataKey="count" position="right" formatter={formatCount} className="indicator-chart-label" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="visually-hidden">
        <caption>Transactions that triggered each indicator</caption>
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">Transactions</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((row) => (
            <tr key={row.indicator}>
              <td>{row.indicator}</td>
              <td>{formatCount(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
