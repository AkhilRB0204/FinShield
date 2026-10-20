import { useLayoutEffect, useRef, useState } from "react";

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

// Label geometry, in px. ROW is the pitch of one label line (--text-xs at
// --leading-data, plus air); the others are clearances.
const ROW = 22;
const FIT_PADDING = 6;
const LEADER_GAP = 4;

/**
 * Decide where each segment's label goes. A label that fits inside its segment
 * sits directly beneath it. The rest each get a row below, joined to the middle
 * of their segment by a vertical leader line. A leader passes through every row
 * above its own, so rows are chosen greedily: each row takes the label (and side
 * of its leader) whose text covers no remaining leader.
 */
function layoutLabels(segments, labelWidths, trackWidth) {
  const inline = [];
  let pending = [];
  segments.forEach((segment, index) => {
    const left = segment.start * trackWidth;
    const span = segment.width * trackWidth;
    if (labelWidths[index] + FIT_PADDING <= span) inline.push({ index, left });
    else pending.push({ index, x: left + span / 2, w: labelWidths[index] });
  });

  // Rightmost first, so ties favor the arrangement that never crosses.
  pending.sort((a, b) => b.x - a.x);
  const rows = [];
  while (pending.length > 0) {
    let best = null;
    for (const item of pending) {
      for (const side of ["right", "left"]) {
        const start = side === "right" ? item.x + LEADER_GAP : item.x - LEADER_GAP - item.w;
        const end = start + item.w;
        const crossings = pending.filter(
          (other) => other !== item && other.x >= start - LEADER_GAP && other.x <= end + LEADER_GAP,
        ).length;
        const outOfBounds = start < 0 || end > trackWidth;
        const cost = crossings + (outOfBounds ? 1.5 : 0);
        if (best === null || cost < best.cost) {
          best = { item, cost, start: Math.min(Math.max(start, 0), Math.max(trackWidth - item.w, 0)) };
        }
      }
    }
    const { item, start } = best;
    // A label pushed back over its own leader is reached from above instead.
    const coversLeader = start <= item.x && item.x <= start + item.w;
    rows.push({ index: item.index, x: item.x, start, coversLeader });
    pending = pending.filter((other) => other !== item);
  }

  const inlineHeight = inline.length > 0 ? ROW : 0;
  return {
    inline,
    rows: rows.map((row, r) => ({ ...row, top: inlineHeight + r * ROW })),
    height: inlineHeight + rows.length * ROW,
  };
}

const pct = (fraction) => `${fraction * 100}%`;

function LabelText({ segment }) {
  return (
    <>
      {segment.label} <span className="score-bar-label-points">{formatPoints(segment.points)}</span>
    </>
  );
}

export default function ScoreBar({ segments, breakdown, level, onHighlight }) {
  const trackRef = useRef(null);
  const measureRefs = useRef([]);
  const [layout, setLayout] = useState(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const compute = () => {
      const widths = segments.map((_, i) => measureRefs.current[i]?.offsetWidth ?? 0);
      setLayout(layoutLabels(segments, widths, track.clientWidth));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(track);
    // Label widths change when the web font replaces the fallback.
    let live = true;
    document.fonts?.ready.then(() => live && compute());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [segments]);

  const threshold = breakdown.review_threshold / breakdown.max_score;
  const thresholdLabelStyle =
    threshold <= 0.5
      ? { left: `calc(${pct(threshold)} + ${LEADER_GAP}px)` }
      : { right: `calc(${pct(1 - threshold)} + ${LEADER_GAP}px)` };
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
        <div className="score-bar-track" ref={trackRef}>
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
        {layout && (
          <div className="score-bar-labels" style={{ height: layout.height }}>
            {layout.inline.map(({ index, left }) => (
              <span key={index} className="score-bar-label" style={{ left, top: 0 }} {...hover(index)}>
                <LabelText segment={segments[index]} />
              </span>
            ))}
            {layout.rows.map(({ index, x, start, top, coversLeader }) => (
              <span key={index}>
                <span
                  className="score-bar-leader"
                  style={{ left: x, height: `calc(var(--space-2) + ${top + (coversLeader ? 1 : ROW / 2 - 2)}px)` }}
                />
                <span className="score-bar-label" style={{ left: start, top }} {...hover(index)}>
                  <LabelText segment={segments[index]} />
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="score-bar-measure">
          {segments.map((segment, i) => (
            <span key={i} ref={(el) => (measureRefs.current[i] = el)} className="score-bar-label">
              <LabelText segment={segment} />
            </span>
          ))}
        </div>
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
