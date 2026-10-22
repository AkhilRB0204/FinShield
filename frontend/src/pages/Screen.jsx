import { useId, useRef, useState } from "react";

import { analyzeMessage } from "../api.js";
import AnalysisResult from "../components/AnalysisResult.jsx";
import Band from "../components/Band.jsx";
import { SCREEN_EXAMPLES } from "./screenExamples.js";
import "./Screen.css";

// Matches the API's limit.
const MAX_LENGTH = 20_000;

/**
 * Screen a message with the message rules. The result is the same assessment
 * the transaction pages show, from the same components; only the rules differ.
 */
export default function Screen() {
  const id = useId();
  const [text, setText] = useState("");
  const [submission, setSubmission] = useState(null);
  const resultRef = useRef(null);

  const screen = (message) => {
    if (!message.trim()) return;
    setSubmission({ key: Date.now(), text: message });
    // On narrow screens the result is below the form. Jump, never scroll smoothly.
    const pane = resultRef.current;
    if (pane && pane.getBoundingClientRect().top > window.innerHeight) pane.scrollIntoView({ block: "start" });
  };

  const loadExample = (example) => {
    setText(example.text);
    screen(example.text);
  };

  return (
    <>
      <Band>
        <h1>Screen a message</h1>
        <p className="screen-intro">
          Paste an email or text message to score it for signs of phishing and payment scams. Include its From,
          Reply-To and Subject lines if you have them; the sender checks read those.
        </p>
      </Band>

      <Band aria-label="Message to screen">
        <form
          className="screen-form"
          onSubmit={(event) => {
            event.preventDefault();
            screen(text);
          }}
        >
          <div className="screen-examples" role="group" aria-labelledby={`${id}-examples`}>
            <p id={`${id}-examples`} className="control-label">
              Try an example
            </p>
            {SCREEN_EXAMPLES.map((example) => (
              <button key={example.label} type="button" className="button-secondary" onClick={() => loadExample(example)}>
                {example.label}
              </button>
            ))}
          </div>
          <div>
            <label className="control-label" htmlFor={`${id}-message`}>
              Message
            </label>
            <textarea
              id={`${id}-message`}
              className="control-input screen-textarea"
              value={text}
              maxLength={MAX_LENGTH}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <button type="submit" className="button-primary" disabled={!text.trim()}>
            Screen message
          </button>
        </form>
      </Band>

      <Band aria-labelledby={`${id}-result`}>
        <h2 id={`${id}-result`}>Result</h2>
        <div ref={resultRef} aria-live="polite">
          {submission === null ? (
            <p className="txn-quiet">
              Screen a message to see its risk score, the indicators behind it, and an explanation.
            </p>
          ) : (
            <AnalysisResult key={submission.key} analyze={analyzeMessage} input={submission.text} />
          )}
        </div>
      </Band>
    </>
  );
}
