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
  if (authenticated) return <AdminDashboard onSignOut={async () => { await fetch("/api/admin/logout", { method: "POST", credentials: "include" }); setAuthenticated(false); }} />;
  return <main><h1>Admin sign in</h1><p>Separate from your household account.</p><form onSubmit={login}><label htmlFor="password">Admin password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /><button type="submit">Sign in</button>{error && <p role="alert">{error}</p>}</form></main>;
}

type Status = {
  generatedAt: string;
  mode: string;
  remoteAccess: string;
  server: { nodeVersion: string; platform: string; uptimeSeconds: number; startedAt: string | null; health: string };
  network: { port: number; adminPort: number; corsOrigins: string[]; webauthn: { rpId: string | null; origin: string | null }; mediaTokenSecretConfigured: boolean; tunnel: string };
  database: { type: string; configured: boolean };
  library: { rootCount: number; bookCount: number; profileCount: number; roots: { id: number; label: string | null; path: string; accessible: boolean; itemCount: number; scan: { status: string; filesFound: number; lastScanAt: string | null; message: string | null } | null }[] };
  scans: { newestScanAt: string | null };
  enrichment: { status: string; queued: number; processed: number; applied: number; review: number; failed: number; skipped: number; startedAt: string | null; finishedAt: string | null; message: string | null };
  freshness: { newestProfileLibraryEntryAt: string | null };
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h2>{title}</h2>{children}</section>;
}

function AdminDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [section, setSection] = React.useState<"overview" | "database" | "api">("overview");
  const [status, setStatus] = React.useState<Status | null>(null);
  const [roots, setRoots] = React.useState<Status["library"]["roots"]>([]);
  const [error, setError] = React.useState("");
  const [path, setPath] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/admin/status", { credentials: "include" });
      if (response.status === 401) { onSignOut(); return; }
      if (!response.ok) throw new Error("Status request failed.");
      const rootResponse = await fetch("/api/admin/library-roots", { credentials: "include" });
      const rootData = rootResponse.ok ? await rootResponse.json() as Status["library"]["roots"] : [];
      const scanResponse = await fetch("/api/admin/scan/status", { credentials: "include" });
      let scanStates: { rootId: number; status: Status["library"]["roots"][number]["scan"] }[] = [];
      if (scanResponse.ok) {
        scanStates = await scanResponse.json() as typeof scanStates;
      }
      setRoots(rootData.map((root) => ({ ...root, scan: scanStates.find((scan) => scan.rootId === root.id)?.status ?? root.scan })));
      setStatus(await response.json() as Status);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load server status."); }
  }, [onSignOut]);
  React.useEffect(() => { void load(); const id = window.setInterval(() => void load(), 15000); return () => window.clearInterval(id); }, [load]);
  async function mutate(url: string, method: string, body?: unknown) {
    setWorking(true);
    try {
      const response = await fetch(url, { method, credentials: "include", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.code || "Request failed.");
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setWorking(false); }
  }
  async function addRoot(event: React.FormEvent) {
    event.preventDefault();
    if (!path.trim()) return;
    await mutate("/api/admin/library-roots", "POST", { path: path.trim(), label: label.trim() || undefined });
    setPath(""); setLabel(""); setAdding(false);
  }
  const rootsRef = React.useRef(roots);
  React.useEffect(() => { rootsRef.current = roots; }, [roots]);
  React.useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const response = await fetch("/api/admin/scan/status", { credentials: "include" });
        if (!response.ok) return;
        const states = await response.json() as { rootId: number; status: Status["library"]["roots"][number]["scan"] }[];
        setRoots(rootsRef.current.map((root) => ({ ...root, scan: states.find((entry) => entry.rootId === root.id)?.status ?? root.scan })));
      } catch { /* transient polling failures leave the last known state visible */ }
    }, 1500);
    return () => window.clearInterval(id);
  }, []);
  return <main className="dashboard">
    <header className="topbar"><div><h1>Admin panel</h1><p>Read-only system and library report · refreshes every 15 seconds</p></div><div className="actions"><button className="secondary" onClick={() => void load()}>Refresh</button><button onClick={onSignOut}>Sign out</button></div></header>
    <nav className="admin-nav" aria-label="Admin sections"><button className={section === "overview" ? "selected" : "secondary"} onClick={() => setSection("overview")}>Overview</button><button className={section === "database" ? "selected" : "secondary"} onClick={() => setSection("database")}>Database</button><button className={section === "api" ? "selected" : "secondary"} onClick={() => setSection("api")}>API docs</button></nav>
    {error && <p role="alert" className="error">{error}</p>}
    {section === "database" ? <DatabaseExplorer /> : section === "api" ? <ApiDocs /> : !status ? <p>Loading server status…</p> : <>
      <div className="grid">
        <StatusCard title="Environment"><dl><dt>Mode</dt><dd>{status.mode}</dd><dt>Remote access</dt><dd>{status.remoteAccess}</dd><dt>Reported</dt><dd>{formatDate(status.generatedAt)}</dd></dl></StatusCard>
        <StatusCard title="Server"><dl><dt>Health</dt><dd><span className="good">{status.server.health}</span></dd><dt>Node</dt><dd>{status.server.nodeVersion}</dd><dt>Platform</dt><dd>{status.server.platform}</dd><dt>Uptime</dt><dd>{Math.floor(status.server.uptimeSeconds / 3600)}h {Math.floor((status.server.uptimeSeconds % 3600) / 60)}m</dd></dl></StatusCard>
        <StatusCard title="Database"><dl><dt>Type</dt><dd>{status.database.type}</dd><dt>Configured</dt><dd>{status.database.configured ? "Yes" : "No"}</dd></dl></StatusCard>
        <StatusCard title="Library"><dl><dt>Books</dt><dd>{status.library.bookCount}</dd><dt>Profiles</dt><dd>{status.library.profileCount}</dd><dt>Folders</dt><dd>{status.library.rootCount}</dd><dt>Latest scan</dt><dd>{formatDate(status.scans.newestScanAt)}</dd><dt>Newest shelf addition</dt><dd>{formatDate(status.freshness.newestProfileLibraryEntryAt)}</dd></dl></StatusCard>
        <StatusCard title="Network configuration"><dl><dt>Family API port</dt><dd>{status.network.port}</dd><dt>Admin port</dt><dd>{status.network.adminPort}</dd><dt>WebAuthn RP</dt><dd>{status.network.webauthn.rpId ?? "Not configured"}</dd><dt>WebAuthn origin</dt><dd>{status.network.webauthn.origin ?? "Not configured"}</dd><dt>Media signing key</dt><dd>{status.network.mediaTokenSecretConfigured ? "Configured" : "Missing / too short"}</dd><dt>Tunnel</dt><dd>{status.network.tunnel}</dd></dl><h3>Allowed client origins</h3><ul>{status.network.corsOrigins.map((origin) => <li key={origin}><code>{origin}</code></li>)}</ul></StatusCard>
        <StatusCard title="Enrichment"><dl><dt>Status</dt><dd>{status.enrichment.status}</dd><dt>Queued</dt><dd>{status.enrichment.queued}</dd><dt>Processed</dt><dd>{status.enrichment.processed}</dd><dt>Applied / review</dt><dd>{status.enrichment.applied} / {status.enrichment.review}</dd><dt>Failed / skipped</dt><dd>{status.enrichment.failed} / {status.enrichment.skipped}</dd><dt>Last finished</dt><dd>{formatDate(status.enrichment.finishedAt)}</dd></dl>{status.enrichment.message && <p>{status.enrichment.message}</p>}</StatusCard>
      </div>
      <StatusCard title="Library folders"><div className="library-actions"><button disabled={working || roots.length === 0} onClick={() => void mutate("/api/admin/scan", "POST", {})}>Scan all folders</button><button className="secondary" disabled={working} onClick={() => setAdding((value) => !value)}>Add folder</button></div>{adding && <form className="root-form" onSubmit={(event) => void addRoot(event)}><label>Folder path<input value={path} onChange={(event) => setPath(event.target.value)} required maxLength={4096} placeholder="/data/audiobooks" /></label><label>Label (optional)<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} placeholder="Audiobooks" /></label><button type="submit" disabled={working}>Add folder</button></form>}<div className="root-list">{roots.length ? roots.map((root) => <article key={root.id} className="root"><div><strong>{root.label || root.path}</strong><p><code>{root.path}</code></p></div><span className={root.accessible ? "good" : "bad"}>{root.accessible ? "Accessible" : "Unavailable"}</span><span>{root.itemCount} books</span><span>Scan: {root.scan?.status ?? "Never scanned"}</span><span>{root.scan?.filesFound ?? 0} files · {formatDate(root.scan?.lastScanAt ?? null)}</span><div className="root-buttons"><button className="secondary" disabled={working} onClick={() => void mutate("/api/admin/scan", "POST", { rootId: root.id })}>Scan</button><button className="danger" disabled={working} onClick={() => { if (window.confirm(`Remove folder configuration for “${root.label || root.path}”? The audio files will not be deleted.`)) void mutate(`/api/admin/library-roots/${root.id}`, "DELETE"); }}>Remove</button></div>{root.scan?.message && <p className="error">{root.scan.message}</p>}</article>) : <p>No folders configured.</p>}</div></StatusCard>
    </>}
  </main>;
}

type TableInfo = { name: string; count: number };
function DatabaseExplorer() {
  const [tables, setTables] = React.useState<TableInfo[]>([]);
  const [selected, setSelected] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [tableData, setTableData] = React.useState<{ columns: { name: string }[]; rows: Record<string, unknown>[]; total: number } | null>(null);
  const [sql, setSql] = React.useState("SELECT * FROM \"MediaItem\" LIMIT 25");
  const [queryResult, setQueryResult] = React.useState<{ rows: Record<string, unknown>[]; truncated: boolean } | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { void fetch("/api/admin/db/tables", { credentials: "include" }).then(async (response) => { if (!response.ok) throw new Error("Unable to list tables."); const result = await response.json() as { tables: TableInfo[] }; setTables(result.tables); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to list tables.")); }, []);
  async function openTable(name: string, nextPage = 1) {
    setSelected(name); setPage(nextPage); setBusy(true); setError("");
    try { const response = await fetch(`/api/admin/db/tables/${encodeURIComponent(name)}?page=${nextPage}&pageSize=25`, { credentials: "include" }); if (!response.ok) throw new Error("Unable to load table."); setTableData(await response.json()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load table."); }
    finally { setBusy(false); }
  }
  async function runQuery(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setQueryResult(null);
    try { const response = await fetch("/api/admin/db/query", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) }); const data = await response.json(); if (!response.ok) throw new Error(data.reason || data.code || "Query failed."); setQueryResult(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Query failed."); }
    finally { setBusy(false); }
  }
  return <section className="card"><h2>Read-only database explorer</h2><p>Browse tables or run one SELECT, EXPLAIN, or approved read-only PRAGMA. Results are capped at 500 rows.</p>{error && <p className="error" role="alert">{error}</p>}<div className="db-layout"><aside><h3>Tables</h3>{tables.map((table) => <button className="table-choice secondary" key={table.name} onClick={() => void openTable(table.name)}>{table.name}<span>{table.count}</span></button>)}</aside><div className="db-content">{selected && <><h3>{selected} · {tableData?.total ?? "…"} rows</h3>{tableData && <DataTable columns={tableData.columns.map((column) => column.name)} rows={tableData.rows} />}{tableData && <div className="pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => void openTable(selected, page - 1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={page * 25 >= tableData.total || busy} onClick={() => void openTable(selected, page + 1)}>Next</button></div>}</>}<form className="sql-form" onSubmit={(event) => void runQuery(event)}><label htmlFor="sql-query">SQL query</label><textarea id="sql-query" value={sql} onChange={(event) => setSql(event.target.value)} rows={5} maxLength={10000} spellCheck={false} /><button disabled={busy}>Run read-only query</button></form>{queryResult && <><h3>Query results{queryResult.truncated ? " · first 500 rows shown" : ""}</h3><DataTable columns={Object.keys(queryResult.rows[0] ?? {})} rows={queryResult.rows} /></>}</div></div></section>;
}

function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (!columns.length) return <p>No rows returned.</p>;
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}><code>{formatCell(row[column])}</code></td>)}</tr>)}</tbody></table></div>;
}
function formatCell(value: unknown): string { if (value === null || value === undefined) return "NULL"; if (typeof value === "object") return JSON.stringify(value); return String(value); }

type ApiRoute = { method: string | string[]; url: string; schema: Record<string, unknown> };
function ApiDocs() {
  const [docs, setDocs] = React.useState<{ admin: ApiRoute[]; family: ApiRoute[] } | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { void fetch("/api/admin/api-docs", { credentials: "include" }).then(async (response) => { if (!response.ok) throw new Error("Unable to load API documentation."); setDocs(await response.json()); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load API documentation.")); }, []);
  return <section className="card"><h2>Live API documentation</h2><p>Generated from the registered Fastify route definitions and schemas at runtime.</p>{error && <p className="error">{error}</p>}{!docs ? <p>Loading routes…</p> : <><RouteList title="Admin API" routes={docs.admin} /><RouteList title="Family API" routes={docs.family} /></>}</section>;
}
function RouteList({ title, routes }: { title: string; routes: ApiRoute[] }) {
  return <div className="route-group"><h3>{title} · {routes.length} routes</h3>{routes.map((route, index) => <details key={`${route.url}-${index}`}><summary><strong>{Array.isArray(route.method) ? route.method.join(", ") : route.method}</strong><code>{route.url}</code></summary><pre>{JSON.stringify(route.schema, null, 2)}</pre></details>)}</div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><AdminLogin /></React.StrictMode>);
