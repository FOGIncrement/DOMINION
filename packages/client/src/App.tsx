import { Navigate, Route, Routes } from "react-router-dom";
import CheatMenu from "./components/CheatMenu.js";
import NavBar from "./components/NavBar.js";
import OfflineSummaryModal from "./components/OfflineSummaryModal.js";
import TopBar from "./components/TopBar.js";
import TutorialOverlay from "./components/TutorialOverlay.js";
import { useMe } from "./api/hooks.js";
import Login from "./pages/Login.js";
import Dashboard from "./pages/Dashboard.js";
import Banking from "./pages/Banking.js";
import Companies from "./pages/Companies.js";
import SupplyChain from "./pages/SupplyChain.js";
import Government from "./pages/Government.js";
import Map from "./pages/Map.js";
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
        <Route path="/supply-chain" element={<SupplyChain />} />
        <Route path="/market" element={<Market />} />
        <Route path="/stocks" element={<StockMarket />} />
        <Route path="/banking" element={<Banking />} />
        <Route path="/government" element={<Government />} />
        <Route path="/map" element={<Map />} />
        <Route path="/world" element={<World />} />
        <Route path="/news" element={<News />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <OfflineSummaryModal />
      <CheatMenu />
      <TutorialOverlay />
    </div>
  );
}
