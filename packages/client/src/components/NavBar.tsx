import { NavLink } from "react-router-dom";
import { useMe, useTutorial } from "../api/hooks.js";

const LOCKED = ["Diplomacy"];

export default function NavBar() {
  const { data: me } = useMe();
  const { data: tutorial } = useTutorial();
  const step = tutorial?.step ?? "completed";
  const governmentLocked = step === "found_company" || step === "hiring";
  const governmentJustUnlocked = step === "government_unlock";

  return (
    <nav className="nav-bar">
      <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Civilization
      </NavLink>
      <NavLink to="/companies" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Companies
      </NavLink>
      <NavLink to="/supply-chain" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Supply Chain
      </NavLink>
      <NavLink to="/stocks" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Stock Market
      </NavLink>
      <NavLink to="/banking" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Banking
      </NavLink>
      {governmentLocked ? (
        <span className="nav-link nav-link--locked" title="Unlocks once your first company has hired workers">
          Government 🔒
        </span>
      ) : (
        <NavLink
          to="/government"
          data-tutorial="tutorial-nav-government"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}${governmentJustUnlocked ? " nav-link--pulse" : ""}`}
        >
          Government
        </NavLink>
      )}
      <NavLink to="/market" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Market
      </NavLink>
      <NavLink to="/map" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Map
      </NavLink>
      <NavLink to="/world" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        World
      </NavLink>
      <NavLink to="/news" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        News
      </NavLink>
      {LOCKED.map((name) => (
        <span key={name} className="nav-link nav-link--locked" title="Unlocks in a later development stage">
          {name} 🔒
        </span>
      ))}
      {me?.isAdmin && (
        <NavLink to="/admin/config" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          🛠 Balance Config
        </NavLink>
      )}
      {me?.isAdmin && (
        <NavLink to="/admin/announcements" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          📣 Announcements
        </NavLink>
      )}
    </nav>
  );
}
