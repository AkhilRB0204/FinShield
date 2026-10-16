import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { listUsers } from "./api.js";

const UserContext = createContext(null);

/**
 * Loads the demo customers once and holds the selected one. Defaults to the
 * first customer the API returns.
 */
export function UserProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error"
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    listUsers({ signal: controller.signal })
      .then((data) => {
        setUsers(data);
        setSelectedId((current) => current ?? data[0]?.user_id ?? null);
        setStatus("ready");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err);
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const value = useMemo(
    () => ({
      users,
      status,
      error,
      selectedUser: users.find((u) => u.user_id === selectedId) ?? null,
      selectUser: setSelectedId,
    }),
    [users, status, error, selectedId],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === null) throw new Error("useUser must be used inside a UserProvider.");
  return context;
}
