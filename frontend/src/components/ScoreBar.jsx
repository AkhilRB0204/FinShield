import { BarLabels, useBarLabels } from "./BarLabels.jsx";
import { formatPoints, riskFill } from "../format.js";
import "./ScoreBar.css";

/**
 * The score as segments, one per triggered indicator in API order, then the
 * compound bonus. `start` and `width` are fractions of `max_score`. Every figure
 * comes from the API; when the score is capped, each segment shrinks by the same
 * factor so the bar ends exactly at `max_score`, while `points` stays the true,
 * unscaled value used in labels.
 */
export function scoreSegments(indicators, breakdown) {
  const parts = indicators.map((i) => ({ label: i.indicator, points: i.points, detail: i.detail }));
  if (breakdown.compound_bonus > 0) {
    // Strips float noise (1.1600000000000001) without rounding a configured value.
    const multiplier = Number(breakdown.compound_multiplier.toPrecision(12));
    parts.push({
      label: "Compound bonus",
      points: breakdown.compound_bonus,
      detail:
        `${indicators.length} indicators were triggered together, so their combined ` +
        `${formatPoints(breakdown.indicator_points)} points are multiplied by ${multiplier}.`,
    });
  }
  const scale = breakdown.capped ? breakdown.max_score / breakdown.uncapped_score : 1;
  let start = 0;
  return parts.map((part) => {
    const width = (part.points * scale) / breakdown.max_score;
    const segment = { ...part, start, width };
    start += width;
    return segment;
  });
}

const pct = (fraction) => `${fraction * 100}%`;

function renderLabel(segment) {
  return (
    <>
      {segment.label} <span className="bar-label-figure">{formatPoints(segment.points)}</span>
    </>
  );
}

export default function ScoreBar({ segments, breakdown, level, onHighlight }) {
  const labels = useBarLabels(segments);

  const threshold = breakdown.review_threshold / breakdown.max_score;
  const thresholdLabelStyle =
    threshold <= 0.5
      ? { left: `calc(${pct(threshold)} + 4px)` }
      : { right: `calc(${pct(1 - threshold)} + 4px)` };
  const hover = (index) => ({
    onMouseEnter: () => onHighlight(index),
    onMouseLeave: () => onHighlight(null),
  });

  return (
    <div className="score-bar">
      <div className="score-bar-visual" aria-hidden="true" style={{ "--risk-fill": riskFill(level) }}>
        <div className="score-bar-axis">
          <span className="score-bar-threshold-label" style={thresholdLabelStyle}>
            Review threshold {formatPoints(breakdown.review_threshold)}
          </span>
        </div>
        <div className="score-bar-track" ref={labels.trackRef}>
          {segments.map((segment, i) => (
            <div
              key={i}
              className="score-segment score-bar-segment"
              style={{ left: pct(segment.start), width: pct(segment.width), "--segment-index": i }}
              {...hover(i)}
            />
          ))}
          <div className="score-bar-threshold" style={{ left: pct(threshold) }} />
        </div>
        <BarLabels items={segments} labels={labels} renderLabel={renderLabel} hover={hover} />
      </div>
      {breakdown.capped && (
        <p className="score-bar-note">
          Capped at {breakdown.max_score} from {formatPoints(breakdown.uncapped_score)}
        </p>
      )}
      <ul className="visually-hidden">
        {segments.map((segment, i) => (
          <li key={i}>
            {segment.label}: {formatPoints(segment.points)} points
          </li>
        ))}
        <li>Review threshold: {formatPoints(breakdown.review_threshold)}</li>
      </ul>
    </div>
  );
}
