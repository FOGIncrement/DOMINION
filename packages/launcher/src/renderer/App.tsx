import { useEffect, useState } from "react";
import Login from "./pages/Login.js";
import Hub from "./pages/Hub.js";
import type { Me } from "./types.js";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  const refreshMe = () => {
    setLoading(true);
    return window.dominion.getMe().then((result) => {
      setMe(result);
      setLoading(false);
      return result;
    });
  };

  useEffect(() => {
    refreshMe();
  }, []);

  if (loading) {
    return (
      <div className="shell">
        <div className="loading">Loading Dominion Launcher...</div>
      </div>
    );
  }

  if (!me) {
    return <Login onLoggedIn={setMe} />;
  }

  return <Hub me={me} onLoggedOut={() => setMe(null)} onRefreshMe={refreshMe} />;
}
