import { useId, useState } from "react";

import { askQuestion, listTransactions } from "../api.js";
import CaseStrip from "../components/CaseStrip.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { formatPoints, transactionNumber } from "../format.js";
import { useApi } from "../useApi.js";
import { SCREEN_EXAMPLES } from "./screenExamples.js";

// Matches the API's limit: room for a pasted message and a question.
const MAX_LENGTH = 21_000;

const PHISHING_SAMPLE = SCREEN_EXAMPLES.find((example) => example.label === "Account-suspension notice");

/**
 * The example questions, covering both engines. The transaction one names the
 * highest-scoring transaction in the dataset, so its figures are real; it is
 * left out until that transaction has loaded, and if it cannot be.
 */
function useStarters() {
  const top = useApi((signal) => listTransactions({ order: "risk", limit: 1, signal }), []);
  const txn = top.status === "ready" ? top.data[0] : null;
  return [
    { label: "Which transactions tripped the geographic rule last month?" },
    txn && { label: `Why did transaction ${transactionNumber(txn.transaction_id)} score ${formatPoints(txn.risk_score)}?` },
    { label: "What does normal look like for customer 3?" },
    PHISHING_SAMPLE && {
      label: "Is this email a phishing attempt?",
      note: "With a sample email pasted in",
      question: `Is this email a phishing attempt?\n\n${PHISHING_SAMPLE.text}`,
    },
  ].filter(Boolean);
}

/**
 * Questions about the transactions and messages, answered from lookups only.
 * The answer renders inline: the text, the transactions it cites as links, and
 * every lookup it was built from.
 */
export default function AskPanel() {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [submission, setSubmission] = useState(null);
  const starters = useStarters();

  const ask = (text) => {
    const question = text.trim();
    if (!question) return;
    setDraft(question);
    setSubmission({ key: Date.now(), question });
  };

  return (
    <section className="ask" aria-label="Ask a question">
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
      >
        <label className="control-label" htmlFor={`${id}-question`}>
          Ask about the transactions, the rules, or a message you paste in
        </label>
        <textarea
          id={`${id}-question`}
          className="control-input ask-question"
          value={draft}
          maxLength={MAX_LENGTH}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a line, for pasted messages; Ctrl or Cmd + Enter asks.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              ask(draft);
            }
          }}
        />
        <div className="ask-submit">
          <button type="submit" className="button-primary" disabled={!draft.trim()}>
            Ask
          </button>
          <p id={`${id}-hint`} className="ask-hint">
            Ctrl or Cmd and Enter also asks.
          </p>
        </div>
      </form>

      <div className="ask-starters" role="group" aria-labelledby={`${id}-starters`}>
        <p id={`${id}-starters`} className="control-label">
          For example
        </p>
        {starters.map((starter) => (
          <button
            key={starter.label}
            type="button"
            className="button-secondary"
            onClick={() => ask(starter.question ?? starter.label)}
          >
            <span>
              {starter.label}
              {starter.note && <span className="ask-starter-note">{starter.note}</span>}
            </span>
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {submission && <AskAnswer key={submission.key} question={submission.question} />}
      </div>
    </section>
  );
}

function AskAnswer({ question }) {
  const result = useApi((signal) => askQuestion(question, { signal }), [question]);

  if (result.status === "loading") {
    return (
      <div className="ask-answer explanation-skeleton" aria-busy="true">
        <span className="visually-hidden">Answering</span>
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" />
        <Skeleton height="1.1em" width="60%" />
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="ask-answer">
        <ErrorNotice error={result.error} subject="The answer" verb="written" onRetry={result.retry} />
        <p className="txn-quiet">The transactions and their scores are unaffected.</p>
      </div>
    );
  }

  const { answer, transactions, checked } = result.data;
  return (
    <div className="ask-answer">
      {/* Model output: rendered as text only, never as HTML or Markdown. */}
      {answer
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, i) => (
          <p key={i} className="explanation-prose">
            {paragraph}
          </p>
        ))}
      {transactions.length > 0 && (
        <>
          <h2 className="quiet-heading">Transactions cited</h2>
          <CaseStrip cases={transactions} />
        </>
      )}
      <Checked calls={checked} />
      <p className="explanation-source">
        Written by Claude from the lookups listed. Claude reports what they returned; it did not score anything.
      </p>
    </div>
  );
}

/** The system shows its work: every lookup, collapsed to one line until opened. */
function Checked({ calls }) {
  if (calls.length === 0) {
    return <p className="ask-checked">Checked: nothing. No lookups were made, so this answer rests on no data.</p>;
  }
  const tools = [...new Set(calls.map((call) => call.tool))].join(", ");
  return (
    <details className="ask-checked">
      <summary>Checked: {tools}</summary>
      <ol className="ask-calls">
        {calls.map((call, i) => (
          <li key={i}>
            <span className="ask-call-tool">{call.tool}</span>
            {call.arguments.length === 0 ? (
              <p className="txn-quiet">No arguments</p>
            ) : (
              <dl className="case-fields">
                {call.arguments.map((argument, j) => {
                  // A pasted message is shown whole, as it was passed: the work shown is the work done.
                  const long = argument.value.includes("\n") || argument.value.length > 80;
                  return (
                    <div key={j} className={long ? "ask-call-long" : undefined}>
                      <dt>{argument.name}</dt>
                      <dd>{argument.value}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
