import Band from "../components/Band.jsx";
import AskPanel from "./AskPanel.jsx";
import "../components/Assessment.css";
import "./Ask.css";

/**
 * Questions answered from lookups only: the transaction data, both rule
 * registries, and the message engine run on text the reader pastes in.
 */
export default function Ask() {
  return (
    <Band>
      <h1>Ask</h1>
      <AskPanel />
    </Band>
  );
}
