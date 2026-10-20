import { NavLink, Outlet } from "react-router";

import ErrorNotice from "./components/ErrorNotice.jsx";
import Skeleton from "./components/Skeleton.jsx";
import { customerLabel, formatMoney } from "./format.js";
import { useUser } from "./UserContext.jsx";
import "./AppShell.css";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transactions", label: "Transactions" },
  { to: "/analyze", label: "Analyze" },
];

export default function AppShell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <p className="rail-brand">FinShield</p>
        <nav aria-label="Main">
          <ul className="rail-nav">
            {NAV.map(({ to, label, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="rail-link">
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <CustomerProfile />
      </aside>
      <main id="main" className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function CustomerProfile() {
  const { users, status, error, retry, selectedUser, selectUser } = useUser();

  if (status === "error") {
    return (
      <section className="rail-profile rail-error" aria-label="Demo customer">
        <ErrorNotice error={error} subject="Customers" onRetry={retry} />
      </section>
    );
  }

  if (status === "ready" && users.length === 0) {
    return (
      <section className="rail-profile" aria-label="Demo customer">
        <p className="rail-error">No demo customers are available, so transactions cannot be analyzed.</p>
      </section>
    );
  }

  if (status === "loading" || selectedUser === null) {
    return (
      <section className="rail-profile" aria-label="Demo customer" aria-busy="true">
        <Skeleton height="2rem" />
        <Skeleton width="70%" />
        <Skeleton width="50%" />
        <Skeleton width="80%" />
      </section>
    );
  }

  return (
    <section className="rail-profile" aria-label="Demo customer">
      <label className="rail-label" htmlFor="customer-select">
        Demo customer
      </label>
      <select
        id="customer-select"
        className="rail-select"
        value={selectedUser.user_id}
        onChange={(event) => selectUser(event.target.value)}
      >
        {users.map((user) => (
          <option key={user.user_id} value={user.user_id}>
            {customerLabel(user.user_id)}
          </option>
        ))}
      </select>
      <dl className="rail-fields">
        <div>
          <dt>Home</dt>
          <dd>
            {selectedUser.home_city}, {selectedUser.home_state}
          </dd>
        </div>
        <div>
          <dt>Average transaction</dt>
          <dd>{formatMoney(selectedUser.average_amount)}</dd>
        </div>
        <div>
          <dt>Usual hours</dt>
          <dd>{selectedUser.active_hours}</dd>
        </div>
        <div>
          <dt>Usual categories</dt>
          <dd>{selectedUser.typical_categories.join(", ")}</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>{selectedUser.transaction_count.toLocaleString("en-US")}</dd>
        </div>
      </dl>
    </section>
  );
}
