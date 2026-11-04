import React from "react";
import { createRoot } from "react-dom/client";
import { copyAdmin } from "./copy";
import "./style.css";

const uploadAudioExtensions = new Set(["mp3", "m4a", "m4b", "flac", "ogg", "wav", "aac"]);

function AdminLogin() {
  const [authenticated, setAuthenticated] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [configured, setConfigured] = React.useState(true);

  React.useEffect(() => {
    void fetch("/api/admin/session", { credentials: "include" }).then((response) => {
      setAuthenticated(response.ok);
    }).catch(() => setAuthenticated(false));
    void fetch("/api/admin/config").then((response) => response.json()).then((result) => {
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
      setError(result.code === "auth_required" ? copyAdmin.signIn.rejected : copyAdmin.signIn.unavailable);
    }
  }

  if (authenticated === null) return <main><p>{copyAdmin.session.checking}</p></main>;
  if (!configured) return <main><h1>{copyAdmin.locked.heading}</h1><p>{copyAdmin.locked.body}</p></main>;
  if (authenticated) return <AdminDashboard onSignOut={async () => { await fetch("/api/admin/logout", { method: "POST", credentials: "include" }); setAuthenticated(false); }} />;
  return <main><h1>{copyAdmin.signIn.heading}</h1><p>{copyAdmin.signIn.hint}</p><form onSubmit={login}><label htmlFor="password">{copyAdmin.signIn.passwordLabel}</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /><button type="submit">{copyAdmin.signIn.submit}</button>{error && <p role="alert">{error}</p>}</form></main>;
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
  storage: { configured: boolean; sync: { status: string; filesDownloaded: number; lastSyncAt: string | null; message: string | null } };
  freshness: { newestProfileLibraryEntryAt: string | null };
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : copyAdmin.dates.never;
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
  const [uploadFiles, setUploadFiles] = React.useState<File[]>([]);
  const [bookName, setBookName] = React.useState("");
  const [uploadNotice, setUploadNotice] = React.useState("");
  const filesInput = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/admin/status", { credentials: "include" });
      if (response.status === 401) { onSignOut(); return; }
      if (!response.ok) throw new Error(copyAdmin.shell.statusRequestFailed);
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : copyAdmin.shell.loadFailed); }
  }, [onSignOut]);
  React.useEffect(() => { void load(); const id = window.setInterval(() => void load(), 15000); return () => window.clearInterval(id); }, [load]);
  async function mutate(url: string, method: string, body?: unknown) {
    setWorking(true);
    try {
      const response = await fetch(url, { method, credentials: "include", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.code || copyAdmin.shell.requestFailed);
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : copyAdmin.shell.requestFailed); }
    finally { setWorking(false); }
  }
  async function addRoot(event: React.FormEvent) {
    event.preventDefault();
    if (!path.trim()) return;
    await mutate("/api/admin/library-roots", "POST", { path: path.trim(), label: label.trim() || undefined });
    setPath(""); setLabel(""); setAdding(false);
  }
  async function uploadSelectedFiles() {
    if (!status?.storage.configured || !uploadFiles.length || !bookName.trim()) {
      setError(copyAdmin.storage.bookNameRequired);
      return;
    }
    setWorking(true);
    setError("");
    setUploadNotice("");
    try {
      for (const [index, file] of uploadFiles.entries()) {
        setUploadNotice(copyAdmin.storage.uploading(file.name, index + 1, uploadFiles.length));
        if (file.size > 50 * 1024 * 1024) throw new Error(copyAdmin.storage.fileTooLarge(file.name));
        const relativePath = file.name;
        const signedResponse = await fetch("/api/admin/storage/upload-url", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookName: bookName.trim(), relativePath }),
        });
        if (!signedResponse.ok) throw new Error(copyAdmin.storage.uploadFailed(file.name));
        const signed = await signedResponse.json() as { url: string };
        const uploaded = await fetch(signed.url, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "x-upsert": "true" },
          body: file,
        });
        if (!uploaded.ok) throw new Error(copyAdmin.storage.uploadFailed(file.name));
      }
      const syncResponse = await fetch("/api/admin/storage/sync", { method: "POST", credentials: "include" });
      if (syncResponse.status === 409) throw new Error(copyAdmin.storage.syncBusy);
      if (!syncResponse.ok) throw new Error(copyAdmin.storage.syncFailed);
      setUploadNotice(copyAdmin.storage.syncStarted);
      setUploadFiles([]);
      setBookName("");
      if (filesInput.current) filesInput.current.value = "";
      await load();
    } catch (cause) {
      setUploadNotice("");
      setError(cause instanceof Error ? cause.message : copyAdmin.storage.syncFailed);
    } finally {
      setWorking(false);
    }
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
    <header className="topbar"><div><h1>{copyAdmin.shell.title}</h1><p>{copyAdmin.shell.subtitle}</p></div><div className="actions"><button className="secondary" onClick={() => void load()}>{copyAdmin.shell.refresh}</button><button onClick={onSignOut}>{copyAdmin.shell.signOut}</button></div></header>
    <nav className="admin-nav" aria-label={copyAdmin.nav.label}><button className={section === "overview" ? "selected" : "secondary"} onClick={() => setSection("overview")}>{copyAdmin.nav.overview}</button><button className={section === "database" ? "selected" : "secondary"} onClick={() => setSection("database")}>{copyAdmin.nav.database}</button><button className={section === "api" ? "selected" : "secondary"} onClick={() => setSection("api")}>{copyAdmin.nav.apiDocs}</button></nav>
    {error && <p role="alert" className="error">{error}</p>}
    {section === "database" ? <DatabaseExplorer /> : section === "api" ? <ApiDocs /> : !status ? <p>{copyAdmin.shell.loading}</p> : <>
      <div className="grid">
        <StatusCard title={copyAdmin.cards.env}><dl><dt>{copyAdmin.fields.mode}</dt><dd>{status.mode}</dd><dt>{copyAdmin.fields.remoteAccess}</dt><dd>{status.remoteAccess}</dd><dt>{copyAdmin.fields.reported}</dt><dd>{formatDate(status.generatedAt)}</dd></dl></StatusCard>
        <StatusCard title={copyAdmin.cards.server}><dl><dt>{copyAdmin.fields.health}</dt><dd><span className="good">{status.server.health}</span></dd><dt>{copyAdmin.fields.node}</dt><dd>{status.server.nodeVersion}</dd><dt>{copyAdmin.fields.platform}</dt><dd>{status.server.platform}</dd><dt>{copyAdmin.fields.uptime}</dt><dd>{Math.floor(status.server.uptimeSeconds / 3600)}h {Math.floor((status.server.uptimeSeconds % 3600) / 60)}m</dd></dl></StatusCard>
        <StatusCard title={copyAdmin.cards.db}><dl><dt>{copyAdmin.fields.type}</dt><dd>{status.database.type}</dd><dt>{copyAdmin.fields.configured}</dt><dd>{status.database.configured ? copyAdmin.fields.yes : copyAdmin.fields.no}</dd></dl></StatusCard>
        <StatusCard title={copyAdmin.cards.library}><dl><dt>{copyAdmin.fields.books}</dt><dd>{status.library.bookCount}</dd><dt>{copyAdmin.fields.profiles}</dt><dd>{status.library.profileCount}</dd><dt>{copyAdmin.fields.folders}</dt><dd>{status.library.rootCount}</dd><dt>{copyAdmin.fields.latestScan}</dt><dd>{formatDate(status.scans.newestScanAt)}</dd><dt>{copyAdmin.fields.newestShelfAddition}</dt><dd>{formatDate(status.freshness.newestProfileLibraryEntryAt)}</dd></dl></StatusCard>
        <StatusCard title={copyAdmin.cards.network}><dl><dt>{copyAdmin.fields.familyPort}</dt><dd>{status.network.port}</dd><dt>{copyAdmin.fields.adminPort}</dt><dd>{status.network.adminPort}</dd><dt>{copyAdmin.fields.webauthnRp}</dt><dd>{status.network.webauthn.rpId ?? copyAdmin.fields.notConfigured}</dd><dt>{copyAdmin.fields.webauthnOrigin}</dt><dd>{status.network.webauthn.origin ?? copyAdmin.fields.notConfigured}</dd><dt>{copyAdmin.fields.mediaSigningKey}</dt><dd>{status.network.mediaTokenSecretConfigured ? copyAdmin.fields.configured : copyAdmin.fields.signingKeyMissing}</dd><dt>{copyAdmin.fields.tunnel}</dt><dd>{status.network.tunnel}</dd></dl><h3>{copyAdmin.fields.allowedOrigins}</h3><ul>{status.network.corsOrigins.map((origin) => <li key={origin}><code>{origin}</code></li>)}</ul></StatusCard>
        <StatusCard title={copyAdmin.cards.enrichment}><dl><dt>{copyAdmin.fields.status}</dt><dd>{status.enrichment.status}</dd><dt>{copyAdmin.fields.queued}</dt><dd>{status.enrichment.queued}</dd><dt>{copyAdmin.fields.processed}</dt><dd>{status.enrichment.processed}</dd><dt>{copyAdmin.fields.appliedReview}</dt><dd>{status.enrichment.applied} / {status.enrichment.review}</dd><dt>{copyAdmin.fields.failedSkipped}</dt><dd>{status.enrichment.failed} / {status.enrichment.skipped}</dd><dt>{copyAdmin.fields.lastFinished}</dt><dd>{formatDate(status.enrichment.finishedAt)}</dd></dl>{status.enrichment.message && <p>{status.enrichment.message}</p>}</StatusCard>
      </div>
      <StatusCard title={copyAdmin.folders.heading}><div className="library-actions"><button disabled={working || roots.length === 0} onClick={() => void mutate("/api/admin/scan", "POST", {})}>{copyAdmin.folders.scanAll}</button><button className="secondary" disabled={working} onClick={() => setAdding((value) => !value)}>{copyAdmin.folders.addFolder}</button></div>{adding && <form className="root-form" onSubmit={(event) => void addRoot(event)}><label>{copyAdmin.folders.pathLabel}<input value={path} onChange={(event) => setPath(event.target.value)} required maxLength={4096} placeholder={copyAdmin.folders.pathPlaceholder} /></label><label>{copyAdmin.folders.labelOptional}<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} placeholder={copyAdmin.folders.labelPlaceholder} /></label><button type="submit" disabled={working}>{copyAdmin.folders.addFolder}</button></form>}<div className="root-list">{roots.length ? roots.map((root) => <article key={root.id} className="root"><div><strong>{root.label || root.path}</strong><p><code>{root.path}</code></p></div><span className={root.accessible ? "good" : "bad"}>{root.accessible ? copyAdmin.folders.accessible : copyAdmin.folders.unavailable}</span><span>{copyAdmin.folders.bookCount(root.itemCount)}</span><span>{copyAdmin.folders.scanState(root.scan?.status ?? copyAdmin.folders.neverScanned)}</span><span>{copyAdmin.folders.scanSummary(root.scan?.filesFound ?? 0, formatDate(root.scan?.lastScanAt ?? null))}</span><div className="root-buttons"><button className="secondary" disabled={working} onClick={() => void mutate("/api/admin/scan", "POST", { rootId: root.id })}>{copyAdmin.folders.scanOne}</button><button className="danger" disabled={working} onClick={() => { if (window.confirm(copyAdmin.folders.removeConfirm(root.label || root.path))) void mutate(`/api/admin/library-roots/${root.id}`, "DELETE"); }}>{copyAdmin.folders.remove}</button></div>{root.scan?.message && <p className="error">{root.scan.message}</p>}</article>) : <p>{copyAdmin.folders.empty}</p>}</div></StatusCard>
      <StatusCard title={copyAdmin.storage.heading}>
        <p>{copyAdmin.storage.explainer}</p>
        {!status.storage.configured ? <p>{copyAdmin.storage.notConfigured}</p> : <>
          <p>{copyAdmin.storage.fileLimit}</p>
          <label>{copyAdmin.storage.bookNameLabel}<input value={bookName} onChange={(event) => setBookName(event.target.value)} required maxLength={120} /></label>
          <label>{copyAdmin.storage.chooseFiles}<input ref={filesInput} type="file" multiple accept=".mp3,.m4a,.m4b,.flac,.ogg,.wav,.aac" onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            const files = selected.filter((file) => uploadAudioExtensions.has(file.name.split(".").pop()?.toLowerCase() ?? ""));
            setUploadFiles(files);
            setUploadNotice("");
            setError(files.length ? "" : copyAdmin.storage.noAudioFiles);
          }} /></label>
          <p>{copyAdmin.storage.selectedFiles(uploadFiles.length)}</p>
          <div className="library-actions">
            <button disabled={working || uploadFiles.length === 0} onClick={() => void uploadSelectedFiles()}>{copyAdmin.storage.upload}</button>
            <button className="secondary" disabled={working || status.storage.sync.status === "syncing"} onClick={() => void mutate("/api/admin/storage/sync", "POST")}>{copyAdmin.storage.sync}</button>
          </div>
          {uploadNotice && <p role="status" className="good">{uploadNotice}</p>}
          <p>{copyAdmin.storage.state(status.storage.sync.status, status.storage.sync.filesDownloaded)}</p>
          {status.storage.sync.message === "storage_sync_failed" && <p role="alert" className="error">{copyAdmin.storage.syncFailed}</p>}
        </>}
      </StatusCard>
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
  React.useEffect(() => { void fetch("/api/admin/db/tables", { credentials: "include" }).then(async (response) => { if (!response.ok) throw new Error(copyAdmin.db.listTablesFailed); const result = await response.json() as { tables: TableInfo[] }; setTables(result.tables); }).catch((cause) => setError(cause instanceof Error ? cause.message : copyAdmin.db.listTablesFailed)); }, []);
  async function openTable(name: string, nextPage = 1) {
    setSelected(name); setPage(nextPage); setBusy(true); setError("");
    try { const response = await fetch(`/api/admin/db/tables/${encodeURIComponent(name)}?page=${nextPage}&pageSize=25`, { credentials: "include" }); if (!response.ok) throw new Error(copyAdmin.db.loadTableFailed); setTableData(await response.json()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copyAdmin.db.loadTableFailed); }
    finally { setBusy(false); }
  }
  async function runQuery(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setQueryResult(null);
    try { const response = await fetch("/api/admin/db/query", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) }); const data = await response.json(); if (!response.ok) throw new Error(data.reason || data.code || copyAdmin.db.queryFailed); setQueryResult(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copyAdmin.db.queryFailed); }
    finally { setBusy(false); }
  }
  return <section className="card"><h2>{copyAdmin.db.heading}</h2><p>{copyAdmin.db.explainer}</p>{error && <p className="error" role="alert">{error}</p>}<div className="db-layout"><aside><h3>{copyAdmin.db.tables}</h3>{tables.map((table) => <button className="table-choice secondary" key={table.name} onClick={() => void openTable(table.name)}>{table.name}<span>{table.count}</span></button>)}</aside><div className="db-content">{selected && <><h3>{copyAdmin.db.tableHeading(selected, tableData?.total ?? null)}</h3>{tableData && <DataTable columns={tableData.columns.map((column) => column.name)} rows={tableData.rows} />}{tableData && <div className="pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => void openTable(selected, page - 1)}>{copyAdmin.pagination.previous}</button><span>{copyAdmin.pagination.page(page)}</span><button className="secondary" disabled={page * 25 >= tableData.total || busy} onClick={() => void openTable(selected, page + 1)}>{copyAdmin.pagination.next}</button></div>}</>}<form className="sql-form" onSubmit={(event) => void runQuery(event)}><label htmlFor="sql-query">{copyAdmin.db.queryLabel}</label><textarea id="sql-query" value={sql} onChange={(event) => setSql(event.target.value)} rows={5} maxLength={10000} spellCheck={false} /><button disabled={busy}>{copyAdmin.db.querySubmit}</button></form>{queryResult && <><h3>{copyAdmin.db.resultsHeading}{queryResult.truncated ? ` · ${copyAdmin.db.resultSuffix}` : ""}</h3><DataTable columns={Object.keys(queryResult.rows[0] ?? {})} rows={queryResult.rows} /></>}</div></div></section>;
}

function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (!columns.length) return <p>{copyAdmin.db.noRows}</p>;
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}><code>{formatCell(row[column])}</code></td>)}</tr>)}</tbody></table></div>;
}
function formatCell(value: unknown): string { if (value === null || value === undefined) return copyAdmin.db.nullDisplay; if (typeof value === "object") return JSON.stringify(value); return String(value); }

type ApiRoute = { method: string | string[]; url: string; schema: Record<string, unknown> };
function ApiDocs() {
  const [docs, setDocs] = React.useState<{ admin: ApiRoute[]; family: ApiRoute[] } | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { void fetch("/api/admin/api-docs", { credentials: "include" }).then(async (response) => { if (!response.ok) throw new Error(copyAdmin.docs.loadFailed); setDocs(await response.json()); }).catch((cause) => setError(cause instanceof Error ? cause.message : copyAdmin.docs.loadFailed)); }, []);
  return <section className="card"><h2>{copyAdmin.docs.heading}</h2><p>{copyAdmin.docs.explainer}</p>{error && <p className="error">{error}</p>}{!docs ? <p>{copyAdmin.docs.loading}</p> : <><RouteList title={copyAdmin.docs.adminApi} routes={docs.admin} /><RouteList title={copyAdmin.docs.familyApi} routes={docs.family} /></>}</section>;
}
function RouteList({ title, routes }: { title: string; routes: ApiRoute[] }) {
  return <div className="route-group"><h3>{copyAdmin.docs.routeSummary(title, routes.length)}</h3>{routes.map((route, index) => <details key={`${route.url}-${index}`}><summary><strong>{Array.isArray(route.method) ? route.method.join(", ") : route.method}</strong><code>{route.url}</code></summary><pre>{JSON.stringify(route.schema, null, 2)}</pre></details>)}</div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><AdminLogin /></React.StrictMode>);
