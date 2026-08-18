import { NavLink } from "react-router-dom";

const LOCKED = ["Banking", "Government", "Diplomacy"];

export default function NavBar() {
  return (
    <nav className="nav-bar">
      <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Civilization
      </NavLink>
      <NavLink to="/companies" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Companies
      </NavLink>
      <NavLink to="/stocks" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Stock Market
      </NavLink>
      <NavLink to="/market" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        Market
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
    </nav>
  );
}
