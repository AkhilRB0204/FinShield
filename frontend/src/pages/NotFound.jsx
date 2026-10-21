import { Link } from "react-router";

import Band from "../components/Band.jsx";

export default function NotFound() {
  return (
    <Band>
      <h1>Page not found</h1>
      <p>
        There is nothing at this address. <Link to="/">Go to the home page</Link>
      </p>
    </Band>
  );
}
