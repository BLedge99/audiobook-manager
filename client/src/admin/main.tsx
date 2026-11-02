import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function AdminLogin() {
  const [authenticated, setAuthenticated] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [configured, setConfigured] = React.useState(true);

  React.useEffect(() => {
    void fetch("/api/admin/session", { credentials: "include" }).then((response) => {
      setAuthenticated(response.ok);
    }).catch(() => setAuthenticated(false));
    void fetch("/api/health").then((response) => response.json()).then((result) => {
      if (result.adminConfigured === false) setConfigured(false);
    }).catch(() => undefined);
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      setAuthenticated(true);
      setPassword("");
    } else {
      const result = await response.json().catch(() => ({}));
      if (result.code === "admin_not_configured") setConfigured(false);
      setError(result.code === "auth_required" ? "The password was not accepted." : "Unable to sign in.");
    }
  }

  if (authenticated === null) return <main><p>Checking admin session…</p></main>;
  if (!configured) return <main><h1>Admin panel locked</h1><p>Set ADMIN_PANEL_PASSWORD in the server environment, then restart the server.</p></main>;
  if (authenticated) return <main><h1>Admin panel</h1><p>Phase 1 is ready. Status dashboard and library controls are coming next.</p><button onClick={async () => { await fetch("/api/admin/logout", { method: "POST", credentials: "include" }); setAuthenticated(false); }}>Sign out</button></main>;
  return <main><h1>Admin sign in</h1><p>Separate from your household account.</p><form onSubmit={login}><label htmlFor="password">Admin password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /><button type="submit">Sign in</button>{error && <p role="alert">{error}</p>}</form></main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><AdminLogin /></React.StrictMode>);
