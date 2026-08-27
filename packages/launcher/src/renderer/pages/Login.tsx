import { useEffect, useState } from "react";
import type { Me } from "../types.js";

export default function Login({ onLoggedIn }: { onLoggedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [settlementName, setSettlementName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Server settings live in the Hub's full SettingsPanel too, but that's
  // only reachable post-login — without a way to change it here first,
  // pointing the launcher at a local dev server would be a chicken-and-egg
  // problem (getSettings/setSettings are local-file IPC calls, no network
  // or auth needed, so this is safe to expose before login).
  const [serverUrl, setServerUrl] = useState("");
  const [editingServer, setEditingServer] = useState(false);

  // Prefill the remembered email (never the password) and current server
  // URL from local settings.
  useEffect(() => {
    window.dominion.getSettings().then((settings) => {
      if (settings.rememberedEmail) setEmail(settings.rememberedEmail);
      setServerUrl(settings.serverUrl);
    });
  }, []);

  const saveServerUrl = async () => {
    const next = await window.dominion.setSettings({ serverUrl: serverUrl.trim() });
    setServerUrl(next.serverUrl);
    setEditingServer(false);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result =
      mode === "register"
        ? await window.dominion.register(email, password, settlementName || undefined)
        : await window.dominion.login(email, password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    await window.dominion.setSettings({ rememberedEmail: email });
    onLoggedIn(result.data);
  };

  return (
    <div className="shell">
      <div>
        <div className="brand">
          <h1>
            CAPIT<span className="wordmark__dash">-</span>ISLE
          </h1>
          <p>Launcher</p>
        </div>
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2>{mode === "register" ? "Found your settlement" : "Welcome back"}</h2>
          <p className="sub">
            {mode === "register" ? "Create an account to start playing." : "Log in to reach the Play button."}
          </p>

          {error && <div className="auth-error">{error}</div>}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="settlementName">Settlement name</label>
              <input
                id="settlementName"
                type="text"
                placeholder="New Settlement"
                value={settlementName}
                onChange={(e) => setSettlementName(e.target.value)}
              />
            </div>
          )}

          <button type="submit" className="btn btn--accent" style={{ width: "100%" }} disabled={submitting}>
            {mode === "register" ? "Found Settlement" : "Log In"}
          </button>

          <div className="auth-toggle">
            {mode === "register" ? (
              <>
                Already have a settlement?{" "}
                <button type="button" onClick={() => setMode("login")}>
                  Log in
                </button>
              </>
            ) : (
              <>
                New to Capitisle?{" "}
                <button type="button" onClick={() => setMode("register")}>
                  Found a settlement
                </button>
              </>
            )}
          </div>
        </form>

        <div className="auth-toggle server-toggle" style={{ marginTop: 10 }}>
          {editingServer ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                style={{ width: 220, fontSize: 11 }}
              />
              <button type="button" onClick={saveServerUrl}>
                Save
              </button>
            </span>
          ) : (
            <>
              Connecting to {serverUrl || "..."}{" "}
              <button type="button" onClick={() => setEditingServer(true)}>
                Change
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
