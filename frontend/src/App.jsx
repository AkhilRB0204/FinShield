import { Route, Routes } from "react-router";

import AppShell from "./AppShell.jsx";
import { UserProvider } from "./UserContext.jsx";
import Analyze from "./pages/Analyze.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Home from "./pages/Home.jsx";
import NotFound from "./pages/NotFound.jsx";
import Screen from "./pages/Screen.jsx";
import TransactionDetail from "./pages/TransactionDetail.jsx";
import Transactions from "./pages/Transactions.jsx";

export default function App() {
  return (
    <UserProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="txn/:id" element={<TransactionDetail />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="screen" element={<Screen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </UserProvider>
  );
}
