import "./Skeleton.css";

/** Static loading placeholder. Never animated: the score bar is the only motion. */
export default function Skeleton({ width = "100%", height = "1em" }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}
