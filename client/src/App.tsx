import { FormEvent, useState } from "react";
import { BookOpen, FolderPlus, Library, LoaderCircle, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { AudiobookDetail } from "./components/AudiobookDetail";
import { AudiobookGrid } from "./components/AudiobookGrid";
import { useLibrary } from "./useLibrary";
import type { Audiobook } from "./types";

function App() {
  const { audiobooks, roots, loading, error, refresh, addRoot, removeRoot, scan } = useLibrary();
  const [selectedBook, setSelectedBook] = useState<Audiobook>();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [showRootForm, setShowRootForm] = useState(false);
  const [working, setWorking] = useState(false);

  const submitRoot = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try {
      await addRoot(path, label);
      setPath("");
      setLabel("");
      setShowRootForm(false);
    } catch (requestError) {
      window.alert(requestError instanceof Error ? requestError.message : "Unable to add library root");
    } finally {
      setWorking(false);
    }
  };

  const runScan = async (rootId?: number) => {
    setWorking(true);
    try { await scan(rootId); } catch (requestError) { window.alert(requestError instanceof Error ? requestError.message : "Unable to start scan"); } finally { setWorking(false); }
  };

  return (
    <div className="min-h-screen bg-[#0b1117] text-slate-100">
      <header className="border-b border-slate-800/80 bg-[#0b1117]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center bg-cyan-400 text-slate-950"><BookOpen size={22} /></span>
            <div><p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Local library</p><h1 className="text-xl font-bold">Audiobook Manager</h1></div>
          </div>
          <button onClick={() => void refresh()} aria-label="Refresh library" className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><RefreshCw size={20} /></button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10">
        <section className="mb-10 flex flex-col justify-between gap-5 border-b border-slate-800 pb-8 sm:flex-row sm:items-end">
          <div><p className="mb-2 text-sm font-medium text-cyan-400">Your collection</p><h2 className="text-4xl font-bold tracking-tight">Browse your books.</h2><p className="mt-3 max-w-xl text-slate-400">Scan local folders to bring your audiobook metadata and artwork into one calm shelf.</p></div>
          <button onClick={() => void runScan()} disabled={working || !roots.length} className="flex items-center justify-center gap-2 bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"><ScanLine size={18} /> Scan library</button>
        </section>

        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Library size={19} className="text-cyan-400" /> Library folders</h2><button onClick={() => setShowRootForm((visible) => !visible)} className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"><FolderPlus size={17} /> Add folder</button></div>
          {showRootForm && <form onSubmit={submitRoot} className="mb-4 grid gap-3 border border-slate-800 bg-slate-900 p-4 sm:grid-cols-[1fr_180px_auto]"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/data/audiobooks" required className="border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400" /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className="border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400" /><button disabled={working} className="bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-white">Add folder</button></form>}
          {roots.length ? <div className="grid gap-3 md:grid-cols-2">{roots.map((root) => <div key={root.id} className="flex items-center justify-between border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="min-w-0"><p className="truncate font-medium">{root.label || root.path}</p><p className="truncate text-xs text-slate-500">{root.path} {root.scanState?.status && `· ${root.scanState.status}`}</p>{root.scanState?.message && <p className="mt-1 text-xs text-red-300">{root.scanState.message}</p>}</div><div className="ml-3 flex items-center gap-1"><button onClick={() => void runScan(root.id)} disabled={working} aria-label={`Scan ${root.label || root.path}`} className="rounded p-2 text-cyan-400 hover:bg-slate-800"><ScanLine size={16} /></button><button onClick={() => void removeRoot(root.id)} aria-label={`Remove ${root.label || root.path}`} className="rounded p-2 text-slate-500 hover:bg-slate-800 hover:text-red-400"><Trash2 size={16} /></button></div></div>)}</div> : <p className="text-sm text-slate-500">No folders configured yet.</p>}
        </section>

        {error && <div className="mb-6 border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
        <section>
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-2xl font-bold">All audiobooks</h2><p className="mt-1 text-sm text-slate-500">{audiobooks.length} {audiobooks.length === 1 ? "title" : "titles"} in your library</p></div>{working && <LoaderCircle className="animate-spin text-cyan-400" size={20} />}</div>
          {loading ? <div className="py-20 text-center text-slate-500">Loading library...</div> : <AudiobookGrid books={audiobooks} onSelect={setSelectedBook} />}
        </section>
      </main>

      <footer className="border-t border-slate-800 px-5 py-6 text-center text-xs text-slate-600">Audiobook Manager · local-first listening</footer>
      {selectedBook && <AudiobookDetail book={selectedBook} onClose={() => setSelectedBook(undefined)} />}
    </div>
  );
}

export default App;
