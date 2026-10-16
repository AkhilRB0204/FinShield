import Band from "./Band.jsx";

/** Stand-in page body until a route is built. */
export default function Placeholder({ title, children }) {
  return (
    <Band>
      <h1>{title}</h1>
      <p>{children}</p>
    </Band>
  );
}
