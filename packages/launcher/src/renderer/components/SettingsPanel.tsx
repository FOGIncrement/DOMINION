import { useEffect, useState } from "react";

export default function SettingsPanel({ onSettingsSaved }: { onSettingsSaved: () => void }) {
  const [serverUrl, setServerUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.dominion.getSettings().then((settings) => setServerUrl(settings.serverUrl));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await window.dominion.setSettings({ serverUrl: serverUrl.trim() });
    setSaving(false);
    setSaved(true);
    // Changing serverUrl may point the launcher at a server the current
    // account isn't logged into — re-check, and fall back to Login if not.
    onSettingsSaved();
  };

  return (
    <div className="card">
      <h2 className="card__title">Settings</h2>
      <div className="field">
        <label htmlFor="serverUrl">Server URL</label>
        <input id="serverUrl" type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
      </div>
      <p className="suggestion" style={{ marginBottom: 10 }}>
        Where Play connects to. Only change this if you're pointing the launcher at your own local dev server.
      </p>
      <div className="trade-row">
        <button className="btn btn--accent" disabled={saving || !serverUrl.trim()} onClick={save}>
          Save
        </button>
        {saved && <span className="suggestion">Saved.</span>}
      </div>
    </div>
  );
}
