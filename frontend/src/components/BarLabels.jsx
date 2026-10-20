import { useLayoutEffect, useRef, useState } from "react";

import "./BarLabels.css";

/**
 * Direct labels for a horizontal stacked bar. A label that fits inside its
 * segment sits directly beneath it; the rest each get a row below, joined to the
 * middle of their segment by a vertical leader line. Nothing is truncated and
 * nothing is hover-only.
 */

// px. ROW is the pitch of one label line (--text-xs at --leading-data, plus air).
const ROW = 22;
const FIT_PADDING = 6;
const LEADER_GAP = 4;

/**
 * `items` are `{ width }` as fractions of the track, laid end to end. Segments
 * narrower than `minPx` are drawn at `minPx` and push the rest along (as flex
 * items with a min-width do), so leaders aim at what is drawn.
 *
 * A leader passes through every row above its own, so rows are chosen greedily:
 * each row takes the label (and side of its leader) whose text covers no
 * remaining leader.
 */
function layoutLabels(items, labelWidths, trackWidth, minPx) {
  const inline = [];
  let pending = [];
  let left = 0;
  items.forEach((item, index) => {
    const span = Math.max(item.width * trackWidth, minPx);
    if (labelWidths[index] + FIT_PADDING <= span) inline.push({ index, left });
    else pending.push({ index, x: left + span / 2, w: labelWidths[index] });
    left += span;
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

/** Measures the labels against the track and lays them out, again on resize. */
export function useBarLabels(items, minPx = 0) {
  const trackRef = useRef(null);
  const measureRefs = useRef([]);
  const [layout, setLayout] = useState(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const compute = () => {
      const widths = items.map((_, i) => measureRefs.current[i]?.offsetWidth ?? 0);
      setLayout(layoutLabels(items, widths, track.clientWidth, minPx));
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
  }, [items, minPx]);

  return { trackRef, measureRefs, layout };
}

/** Renders the labels laid out by `useBarLabels`. Place directly after the track. */
export function BarLabels({ items, labels, renderLabel, hover = () => ({}) }) {
  const { layout, measureRefs } = labels;
  return (
    <>
      {layout && (
        <div className="bar-labels" style={{ height: layout.height }}>
          {layout.inline.map(({ index, left }) => (
            <span key={index} className="bar-label" style={{ left, top: 0 }} {...hover(index)}>
              {renderLabel(items[index])}
            </span>
          ))}
          {layout.rows.map(({ index, x, start, top, coversLeader }) => (
            <span key={index}>
              <span
                className="bar-leader"
                style={{ left: x, height: `calc(var(--space-2) + ${top + (coversLeader ? 1 : ROW / 2 - 2)}px)` }}
              />
              <span className="bar-label" style={{ left: start, top }} {...hover(index)}>
                {renderLabel(items[index])}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="bar-labels-measure">
        {items.map((item, i) => (
          <span key={i} ref={(el) => (measureRefs.current[i] = el)} className="bar-label">
            {renderLabel(item)}
          </span>
        ))}
      </div>
    </>
  );
}
