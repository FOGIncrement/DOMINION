import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api/client.js";

export default function Login() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [settlementName, setSettlementName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "register") {
        return api.register(email, password, settlementName || "New Settlement");
      }
      return api.login(email, password);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  return (
    <div className="auth-shell">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <h1>Dominion</h1>
        <p className="sub">
          {mode === "register" ? "Found your settlement." : "Return to your civilization."}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
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

        <button type="submit" className="btn btn--accent" style={{ width: "100%" }} disabled={mutation.isPending}>
          {mode === "register" ? "Found Settlement" : "Enter World"}
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
              New to Dominion?{" "}
              <button type="button" onClick={() => setMode("register")}>
                Found a settlement
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
