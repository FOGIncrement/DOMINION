import { useState } from "react";
import AnnouncementsFeed from "../components/AnnouncementsFeed.js";
import SettingsPanel from "../components/SettingsPanel.js";
import type { Me } from "../types.js";

export default function Hub({
  me,
  onLoggedOut,
  onRefreshMe,
}: {
  me: Me;
  onLoggedOut: () => void;
  onRefreshMe: () => Promise<Me | null>;
}) {
  const [launching, setLaunching] = useState(false);

  const play = async () => {
    setLaunching(true);
    await window.dominion.play();
    setLaunching(false);
  };

  const logout = async () => {
    await window.dominion.logout();
    onLoggedOut();
  };

  return (
    <div className="hub">
      <div className="hub__top">
        <div className="brand" style={{ textAlign: "left", marginBottom: 0 }}>
          <h1 style={{ fontSize: 20 }}>
            CAPIT<span className="wordmark__dash">-</span>ISLE
          </h1>
        </div>
        <div className="hub__account">
          Signed in as <b>{me.email}</b>
          {me.isAdmin && " · admin"}
          {" — "}
          <button className="btn" style={{ padding: "3px 8px", fontSize: 11 }} onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <div className="play-row">
        <button className="play-button" disabled={launching} onClick={play}>
          {launching ? "Launching..." : "Play"}
        </button>
      </div>

      <AnnouncementsFeed />
      <div style={{ height: 16 }} />
      <SettingsPanel onSettingsSaved={onRefreshMe} />
    </div>
  );
}
