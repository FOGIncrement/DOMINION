import { Navigate, Route, Routes } from "react-router-dom";
import NavBar from "./components/NavBar.js";
import OfflineSummaryModal from "./components/OfflineSummaryModal.js";
import TopBar from "./components/TopBar.js";
import { useMe } from "./api/hooks.js";
import Login from "./pages/Login.js";
import Dashboard from "./pages/Dashboard.js";
import Companies from "./pages/Companies.js";
import Market from "./pages/Market.js";
import StockMarket from "./pages/StockMarket.js";
import World from "./pages/World.js";
import News from "./pages/News.js";

export default function App() {
  const { data: me, isLoading, isError } = useMe();

  if (isLoading) {
    return (
      <div className="auth-shell">
        <div className="loading">Loading Dominion...</div>
      </div>
    );
  }

  if (isError || !me) {
    return <Login />;
  }

  return (
    <div className="app-shell">
      <TopBar />
      <NavBar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/market" element={<Market />} />
        <Route path="/stocks" element={<StockMarket />} />
        <Route path="/world" element={<World />} />
        <Route path="/news" element={<News />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <OfflineSummaryModal />
    </div>
  );
}
