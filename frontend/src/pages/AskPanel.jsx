import { useId, useState } from "react";

import { askQuestion } from "../api.js";
import CaseStrip from "../components/CaseStrip.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useApi } from "../useApi.js";

// Each one exercises a different tool, so together they show what can be asked.
const STARTERS = [
  "Which transactions scored highest, and what drove their scores?",
  "Which transactions are consistent with card-testing patterns?",
  "How many of Customer 009's transactions were flagged for review?",
];

/**
 * Questions about the dataset, answered from lookups only. The answer renders
 * inline: the text, the transactions it cites as links, and every lookup it
 * was built from.
 */
export default function AskPanel() {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [submission, setSubmission] = useState(null);

  const ask = (text) => {
    const question = text.trim();
    if (!question) return;
    setDraft(question);
    setSubmission({ key: Date.now(), question });
  };

  return (
    <section className="ask" aria-label="Ask about the transactions">
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
      >
        <label className="control-label" htmlFor={`${id}-question`}>
          Ask about the transactions
        </label>
        <div className="ask-row">
          <input
            id={`${id}-question`}
            className="control-input"
            value={draft}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="button-primary" disabled={!draft.trim()}>
            Ask
          </button>
        </div>
      </form>

      <div className="ask-starters" role="group" aria-labelledby={`${id}-starters`}>
        <p id={`${id}-starters`} className="control-label">
          For example
        </p>
        {STARTERS.map((question) => (
          <button key={question} type="button" className="button-secondary" onClick={() => ask(question)}>
            {question}
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
                {call.arguments.map((argument, j) => (
                  <div key={j}>
                    <dt>{argument.name}</dt>
                    <dd>{argument.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
