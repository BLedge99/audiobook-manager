import { useState } from "react";
import { GitMerge, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import type { TagSummary } from "../types";

/**
 * Spec 20 — the tag manager.
 *
 * Custom tags are a managed household vocabulary (spec 18), so this is a real
 * CRUD surface rather than free text on a book: create, rename, merge, delete.
 */

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const profileId = window.localStorage.getItem("profileId");
  const headers: Record<string, string> = {};
  if (options?.body) headers["Content-Type"] = "application/json";
  if (profileId) headers["x-profile-id"] = profileId;
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options?.headers as Record<string, string>) } });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message || body;
    } catch {
      /* not json */
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function TagManager({ tags, onChanged }: { tags: TagSummary[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<number>();
  const [renameValue, setRenameValue] = useState("");
  const [mergingId, setMergingId] = useState<number>();
  const [mergeTarget, setMergeTarget] = useState<number | "">("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong");
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      await request("/api/tags", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      setMessage(undefined);
    });
  };

  return (
    <section aria-labelledby="tag-manager" className="border border-slate-800 bg-slate-900/50 p-5">
      <h2 id="tag-manager" className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <TagIcon size={18} className="text-cyan-400" aria-hidden="true" /> Tags
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Your own labels, shared across the household. Assign them to any book from its detail page.
      </p>

      <form onSubmit={create} className="mb-5 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New tag, e.g. bedtime"
          aria-label="New tag name"
          maxLength={40}
          className="min-w-0 flex-1 border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
        />
        <button type="submit" className="flex items-center gap-2 bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
          <Plus size={15} /> Add
        </button>
      </form>

      {error && <p className="mb-3 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mb-3 border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">{message}</p>}

      {tags.length === 0 ? (
        <p className="text-sm text-slate-500">No tags yet.</p>
      ) : (
        <ul className="grid gap-2">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-2 border border-slate-800 bg-slate-950/40 px-3 py-2">
              {renamingId === tag.id ? (
                <input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  aria-label={`Rename ${tag.name}`}
                  className="min-w-0 flex-1 border border-slate-700 bg-slate-900 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                  {tag.name} <span className="text-xs text-slate-500">({tag.count})</span>
                </span>
              )}

              {renamingId === tag.id ? (
                <>
                  <button
                    type="button"
                    className="rounded border border-cyan-400 px-2 py-1 text-xs text-cyan-300"
                    onClick={() =>
                      void run(async () => {
                        await request(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name: renameValue }) });
                        setRenamingId(undefined);
                      })
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="rounded px-2 py-1 text-xs text-slate-400" onClick={() => setRenamingId(undefined)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="rounded px-2 py-1 text-xs text-slate-400 hover:text-cyan-300" onClick={() => { setRenamingId(tag.id); setRenameValue(tag.name); }}>
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${tag.name}`}
                    className="rounded p-1.5 text-slate-500 hover:text-red-400"
                    onClick={() => void run(async () => { await request(`/api/tags/${tag.id}`, { method: "DELETE" }); })}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {tags.length > 1 && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <p className="mb-2 text-sm font-semibold text-slate-300">Merge tags</p>
          <p className="mb-3 text-xs text-slate-500">
            Combine two tags into one. Every book carrying the source tag moves to the target.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-400">
              <span className="mb-1 block">Merge</span>
              <select
                aria-label="Tag to merge"
                value={mergingId ?? ""}
                onChange={(event) => setMergingId(event.target.value ? Number(event.target.value) : undefined)}
                className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
              >
                <option value="">Choose a tag</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              <span className="mb-1 block">Into</span>
              <select
                aria-label="Merge into tag"
                value={mergeTarget}
                onChange={(event) => setMergeTarget(event.target.value ? Number(event.target.value) : "")}
                className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
              >
                <option value="">Choose a tag</option>
                {tags
                  .filter((tag) => tag.id !== mergingId)
                  .map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={!mergingId || !mergeTarget}
              className="flex items-center gap-2 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-400 disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const moved = await request<{ moved: number }>(`/api/tags/${mergingId}/merge`, {
                    method: "POST",
                    body: JSON.stringify({ targetTagId: mergeTarget }),
                  });
                  setMessage(`Merged ${tags.find((t) => t.id === mergingId)?.name} into ${tags.find((t) => t.id === mergeTarget)?.name} — ${moved.moved} ${moved.moved === 1 ? "book" : "books"} moved.`);
                  setMergingId(undefined);
                  setMergeTarget("");
                })
              }
            >
              <GitMerge size={15} /> Merge
            </button>
          </div>
        </div>
      )}
    </section>
  );
}