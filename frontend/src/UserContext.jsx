import { createContext, useContext, useMemo, useState } from "react";

import { listUsers } from "./api.js";
import { useApi } from "./useApi.js";

const UserContext = createContext(null);

/**
 * Loads the demo customers once and holds the selected one. Defaults to the
 * first customer the API returns.
 */
export function UserProvider({ children }) {
  const result = useApi((signal) => listUsers({ signal }), []);
  const [selectedId, setSelectedId] = useState(null);

  const value = useMemo(() => {
    const users = result.data ?? [];
    const id = selectedId ?? users[0]?.user_id ?? null;
    return {
      users,
      status: result.status,
      error: result.error ?? null,
      retry: result.retry,
      selectedUser: users.find((u) => u.user_id === id) ?? null,
      selectUser: setSelectedId,
    };
  }, [result, selectedId]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === null) throw new Error("useUser must be used inside a UserProvider.");
  return context;
}
