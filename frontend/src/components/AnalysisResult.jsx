import { useEffect, useMemo, useState } from "react";

import { AssessmentColumns, ColumnsSkeleton, ScoreHeadline, ScoreSkeleton } from "./Assessment.jsx";
import ErrorNotice from "./ErrorNotice.jsx";
import ScoreBar, { scoreSegments } from "./ScoreBar.jsx";
import Skeleton from "./Skeleton.jsx";
import "./AnalysisResult.css";

/**
 * The result of scoring something: headline, score bar, indicators and
 * explanation. It does not know what was scored. `analyze(input, options)` is
 * an API function answering in the `/analyze` shape (`analyzeTransaction`,
 * `analyzeMessage`); keep it a stable module-level function, since a new one
 * each render would re-run the request.
 *
 * Two requests: without the explanation, so the score and its bar render
 * without waiting on the model, and with it. Scoring is deterministic, so both
 * carry the same assessment.
 */
export default function AnalysisResult({ analyze, input }) {
  const [scored, setScored] = useState({ status: "loading" });
  const [explained, setExplained] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [highlighted, setHighlighted] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const settle = (set) => [
      (data) => set({ status: "ready", data }),
      (error) => error?.name !== "AbortError" && set({ status: "error", error }),
    ];
    setScored({ status: "loading" });
    setExplained({ status: "loading" });
    analyze(input, { explanation: false, signal }).then(...settle(setScored));
    analyze(input, { signal }).then(...settle(setExplained));
    return () => controller.abort();
  }, [analyze, input, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  const response = scored.data ?? explained.data;
  const assessment = response?.assessment;
  const segments = useMemo(
    () => (assessment ? scoreSegments(assessment.indicators, assessment.breakdown) : []),
    [assessment],
  );

  if (!assessment) {
    if (scored.status === "error") {
      return <ErrorNotice error={scored.error} subject="The assessment" verb="completed" onRetry={retry} />;
    }
    return <AnalysisResultSkeleton />;
  }

  return (
    <div className="analysis-result">
      <ScoreHeadline
        score={assessment.risk_score}
        level={assessment.risk_level}
        flagged={assessment.flagged_for_review}
      />
      <ScoreBar
        segments={segments}
        breakdown={assessment.breakdown}
        level={assessment.risk_level}
        onHighlight={setHighlighted}
      />
      <AssessmentColumns
        segments={segments}
        notTriggered={assessment.indicators_not_triggered}
        highlighted={highlighted}
        explanation={{ ...explained, retry }}
        headingLevel={3}
      />
    </div>
  );
}

function AnalysisResultSkeleton() {
  return (
    <div className="analysis-result" aria-busy="true">
      <ScoreSkeleton />
      <Skeleton height="calc(var(--score-bar-height) + 3.5rem)" />
      <ColumnsSkeleton />
    </div>
  );
}
