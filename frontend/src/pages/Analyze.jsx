import { useEffect, useId, useMemo, useRef, useState } from "react";

import { analyzeTransaction, getReference } from "../api.js";
import { AssessmentColumns, ColumnsSkeleton, ScoreHeadline, ScoreSkeleton } from "../components/Assessment.jsx";
import Band from "../components/Band.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import ScoreBar, { scoreSegments } from "../components/ScoreBar.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { customerLabel } from "../format.js";
import { useApi } from "../useApi.js";
import { useUser } from "../UserContext.jsx";
import "./Analyze.css";

const EMPTY_FORM = {
  amount: "",
  merchant: "",
  category: "",
  city: "",
  latitude: "",
  longitude: "",
  timestamp: "",
};

/** "YYYY-MM-DDTHH:MM" in local time, the format a datetime-local input takes. */
function localDateTime(date, hour = null) {
  const pad = (n) => String(n).padStart(2, "0");
  const h = hour ?? date.getHours();
  const m = hour === null ? date.getMinutes() : 0;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(h)}:${pad(m)}`;
}

const cityKey = (c) => `${c.city}, ${c.state}`;

export default function Analyze() {
  const reference = useApi((signal) => getReference({ signal }), []);
  const { selectedUser, status: userStatus } = useUser();
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, timestamp: localDateTime(new Date()) }));
  const [submission, setSubmission] = useState(null);
  const resultRef = useRef(null);

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const cities = reference.data?.cities ?? [];
  const chooseCity = (event) => {
    const city = cities.find((c) => cityKey(c) === event.target.value);
    setForm((f) => ({
      ...f,
      city: event.target.value,
      latitude: city ? String(city.latitude) : "",
      longitude: city ? String(city.longitude) : "",
    }));
  };

  const loadExample = () => {
    const miami = cities.find((c) => c.city === "Miami");
    setForm({
      amount: "1000.00",
      merchant: "GiftCardMall",
      category: "gift_cards",
      city: miami ? cityKey(miami) : "",
      latitude: miami ? String(miami.latitude) : "",
      longitude: miami ? String(miami.longitude) : "",
      timestamp: localDateTime(new Date(), 3),
    });
  };

  const submit = (event) => {
    event.preventDefault();
    const city = cities.find((c) => cityKey(c) === form.city);
    setSubmission({
      key: Date.now(),
      body: {
        user_id: selectedUser.user_id,
        amount: Number(form.amount),
        merchant: form.merchant.trim(),
        category: form.category,
        timestamp: form.timestamp,
        city: city.city,
        state: city.state,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      },
    });
    // On narrow screens the result is below the form. Jump, never scroll smoothly.
    const pane = resultRef.current;
    if (pane && pane.getBoundingClientRect().top > window.innerHeight) pane.scrollIntoView({ block: "start" });
  };

  const canSubmit = userStatus === "ready" && selectedUser !== null && reference.status === "ready";

  return (
    <>
      <Band>
        <h1>Analyze</h1>
        <p className="analyze-intro">
          Score a transaction against{" "}
          {selectedUser ? <strong>{customerLabel(selectedUser.user_id)}</strong> : "the selected customer"}
          {selectedUser && `, who lives in ${selectedUser.home_city}, ${selectedUser.home_state}`}. Change the
          customer in the panel on the left.
        </p>
      </Band>

      <Band aria-label="Transaction to score">
        {reference.status === "error" && (
          <ErrorNotice error={reference.error} subject="The form's categories and cities" onRetry={reference.retry} />
        )}
        {reference.status === "loading" && <FormSkeleton />}
        {reference.status === "ready" && (
          <AnalyzeForm
            form={form}
            set={set}
            chooseCity={chooseCity}
            loadExample={loadExample}
            submit={submit}
            reference={reference.data}
            canSubmit={canSubmit}
            customerMissing={userStatus === "error"}
          />
        )}
      </Band>

      <Band aria-labelledby="result-heading">
        <h2 id="result-heading">Result</h2>
        <div ref={resultRef} className="analyze-result" aria-live="polite">
          {submission === null ? (
            <p className="txn-quiet">
              Submit a transaction to see its risk score, the indicators behind it, and an explanation.
            </p>
          ) : (
            <AnalyzeResult key={submission.key} body={submission.body} />
          )}
        </div>
      </Band>
    </>
  );
}

function AnalyzeForm({ form, set, chooseCity, loadExample, submit, reference, canSubmit, customerMissing }) {
  const id = useId();
  const field = (name) => `${id}-${name}`;
  return (
    <form className="analyze-form" onSubmit={submit}>
      <div className="analyze-example">
        <button type="button" className="button-secondary" onClick={loadExample}>
          Load a flagged example
        </button>
        <p>Fills the form with $1,000 of gift cards bought in Miami at 3:00 in the morning.</p>
      </div>

      <div className="analyze-fields">
        <div>
          <label className="control-label" htmlFor={field("amount")}>Amount (USD)</label>
          <input
            id={field("amount")}
            className="control-input"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={form.amount}
            onChange={set("amount")}
          />
        </div>
        <div>
          <label className="control-label" htmlFor={field("merchant")}>Merchant</label>
          <input
            id={field("merchant")}
            className="control-input"
            type="text"
            autoComplete="off"
            required
            value={form.merchant}
            onChange={set("merchant")}
          />
        </div>
        <div>
          <label className="control-label" htmlFor={field("category")}>Category</label>
          <select
            id={field("category")}
            className="control-select"
            required
            value={form.category}
            onChange={set("category")}
          >
            <option value="" disabled>
              Choose a category
            </option>
            {/* The value is submitted, never shown; the label is the display text. */}
            {reference.categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="control-label" htmlFor={field("timestamp")}>Date and time</label>
          <input
            id={field("timestamp")}
            className="control-input"
            type="datetime-local"
            required
            value={form.timestamp}
            onChange={set("timestamp")}
          />
        </div>
        <div className="analyze-field-wide">
          <label className="control-label" htmlFor={field("city")}>City</label>
          <select id={field("city")} className="control-select" required value={form.city} onChange={chooseCity}>
            <option value="" disabled>
              Choose a city
            </option>
            {reference.cities.map((c) => (
              <option key={cityKey(c)} value={cityKey(c)}>
                {cityKey(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="control-label" htmlFor={field("latitude")}>Latitude</label>
          <input
            id={field("latitude")}
            className="control-input"
            type="number"
            step="any"
            min="-90"
            max="90"
            required
            value={form.latitude}
            onChange={set("latitude")}
            aria-describedby={field("coords-hint")}
          />
        </div>
        <div>
          <label className="control-label" htmlFor={field("longitude")}>Longitude</label>
          <input
            id={field("longitude")}
            className="control-input"
            type="number"
            step="any"
            min="-180"
            max="180"
            required
            value={form.longitude}
            onChange={set("longitude")}
            aria-describedby={field("coords-hint")}
          />
        </div>
        <p id={field("coords-hint")} className="analyze-hint analyze-field-wide">
          Choosing a city fills in its coordinates. Edit them to place the transaction elsewhere.
        </p>
      </div>

      <div className="analyze-actions">
        <button type="submit" className="button-primary" disabled={!canSubmit}>
          Analyze transaction
        </button>
        {customerMissing && (
          <p className="txn-quiet">Customers could not be loaded, so there is no one to score against.</p>
        )}
      </div>
    </form>
  );
}

/**
 * Two requests, like the detail page: without the explanation so the score
 * renders at once, then with it. Remounted (by key) for every submission.
 */
function AnalyzeResult({ body }) {
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
    analyzeTransaction(body, { explanation: false, signal }).then(...settle(setScored));
    analyzeTransaction(body, { signal }).then(...settle(setExplained));
    return () => controller.abort();
  }, [body, attempt]);

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
    return <ResultSkeleton />;
  }

  return (
    <div className="analyze-result-body">
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

function ResultSkeleton() {
  return (
    <div className="analyze-result-body" aria-busy="true">
      <ScoreSkeleton />
      <Skeleton height="calc(var(--score-bar-height) + 3.5rem)" />
      <ColumnsSkeleton />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="analyze-form" aria-busy="true" aria-label="Loading form">
      <Skeleton width="11rem" height="2.5rem" />
      <div className="analyze-fields" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={i === 4 ? "analyze-field-wide" : undefined}>
            <Skeleton width="6rem" height="var(--text-sm)" />
            <div style={{ height: "var(--space-1)" }} />
            <Skeleton height="2.5rem" />
          </div>
        ))}
      </div>
      <Skeleton width="10rem" height="2.5rem" />
    </div>
  );
}
