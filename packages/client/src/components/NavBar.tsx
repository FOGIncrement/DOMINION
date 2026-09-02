import { NavLink } from "react-router-dom";
import { useMe, useTutorial } from "../api/hooks.js";

const LOCKED = ["Diplomacy"];

export default function NavBar({ territoryLocked = false }: { territoryLocked?: boolean }) {
  const { data: me } = useMe();
  const { data: tutorial } = useTutorial();
  const step = tutorial?.step ?? "completed";
  const governmentLocked = territoryLocked || step === "found_company" || step === "hiring";
  const governmentJustUnlocked = step === "government_unlock";

  // Every link but Continent is locked until a brand-new player picks their
  // one starting territory (see App.tsx's needsStartingTerritory gate) —
  // every route already renders the Continent picker regardless of what's
  // clicked while this is true, so these just make that visible up front.
  const otherLocked = territoryLocked;

  return (
    <nav className="nav-bar">
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Home 🔒
        </span>
      ) : (
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Home
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Companies 🔒
        </span>
      ) : (
        <NavLink to="/companies" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Companies
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Supply Chain 🔒
        </span>
      ) : (
        <NavLink to="/supply-chain" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Supply Chain
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Stock Market 🔒
        </span>
      ) : (
        <NavLink to="/stocks" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Stock Market
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Banking 🔒
        </span>
      ) : (
        <NavLink to="/banking" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Banking
        </NavLink>
      )}
      {governmentLocked ? (
        <span
          className="nav-link nav-link--locked"
          title={territoryLocked ? "Choose your starting territory first" : "Unlocks once your first company has hired workers"}
        >
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
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          Market 🔒
        </span>
      ) : (
        <NavLink to="/market" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Market
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          My Territory 🔒
        </span>
      ) : (
        <NavLink to="/map" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          My Territory
        </NavLink>
      )}
      <NavLink to="/continent" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Continent
      </NavLink>
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          World 🔒
        </span>
      ) : (
        <NavLink to="/world" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          World
        </NavLink>
      )}
      {otherLocked ? (
        <span className="nav-link nav-link--locked" title="Choose your starting territory first">
          News 🔒
        </span>
      ) : (
        <NavLink to="/news" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          News
        </NavLink>
      )}
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
