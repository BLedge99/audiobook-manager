import { useState } from "react";
import { GitMerge, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import type { TagSummary } from "../types";
import { Btn, Field, MachineHead, Notice } from "../ui/primitives";

/**
 * Spec 20 -- the tag manager.
 *
 * Custom tags are a managed household vocabulary (spec 18), so this is a real
 * CRUD surface rather than free text on a book: create, rename, merge, delete.
 *
 * This is dense data, not a browsing surface, so the rows stay tight and
 * scannable. The toy lives in the panel it sits in, not in every line of it.
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

  const selectClass =
    "min-w-0 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/30 bg-surface px-2.5 py-2 text-[14px] font-bold text-ink";

  return (
    <section aria-labelledby="tag-manager" className="panel p-4 sm:p-5">
      <MachineHead id="tag-manager" title="Tags" count={`${tags.length}`}>
        <TagIcon size={20} className="shrink-0 text-rasp" aria-hidden="true" />
      </MachineHead>
      <p className="text-[13.5px] text-ink2">
        Your own labels, shared across the household. Assign them to any book from its detail page.
      </p>

      <form onSubmit={create} className="mt-4 flex flex-wrap gap-2">
        <Field
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New tag, e.g. bedtime"
          aria-label="New tag name"
          maxLength={40}
          className="min-w-0 flex-1"
        />
        <Btn type="submit" variant="primary">
          <Plus size={15} aria-hidden="true" /> Add
        </Btn>
      </form>

      {error && <Notice tone="error" role="alert" className="mt-3">{error}</Notice>}
      {message && <Notice tone="info" role="status" className="mt-3">{message}</Notice>}

      {tags.length === 0 ? (
        <p className="panel panel--sunk mt-4 px-4 py-5 text-center text-[13.5px] text-ink2">No tags yet.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {tags.map((tag, index) => (
            /* The name stays first in the item's text content: the E2E suite
               locates tags with a listitem filter anchored to `^<name>`. */
            <li
              key={tag.id}
              className={`flex flex-wrap items-center gap-2 rounded-[16px_13px_16px_13px/13px_16px_13px_16px] border-2 border-ink/25 px-3 py-2 ${
                index % 2 ? "bg-sunk" : "bg-surface"
              }`}
            >
              {renamingId === tag.id ? (
                <Field
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  aria-label={`Rename ${tag.name}`}
                  className="min-w-0 flex-1"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                  {tag.name} <span className="text-[12px] font-bold text-ink3 tnum">({tag.count})</span>
                </span>
              )}

              {renamingId === tag.id ? (
                <>
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      void run(async () => {
                        await request(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name: renameValue }) });
                        setRenamingId(undefined);
                      })
                    }
                  >
                    Save
                  </Btn>
                  <Btn size="sm" variant="quiet" onClick={() => setRenamingId(undefined)}>
                    Cancel
                  </Btn>
                </>
              ) : (
                <>
                  <Btn
                    size="sm"
                    variant="quiet"
                    onClick={() => { setRenamingId(tag.id); setRenameValue(tag.name); }}
                  >
                    Rename
                  </Btn>
                  <Btn
                    size="sm"
                    variant="quiet"
                    aria-label={`Delete ${tag.name}`}
                    className="text-rasp-ink"
                    onClick={() => void run(async () => { await request(`/api/tags/${tag.id}`, { method: "DELETE" }); })}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Btn>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {tags.length > 1 && (
        <div className="mt-5 border-t-2 border-dashed border-ink/20 pt-4">
          <p className="font-display text-[16px] font-semibold text-ink">Merge tags</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Combine two tags into one. Every book carrying the source tag moves to the target.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 text-[12px] font-bold text-ink3">
              <span className="mb-1 block">Merge</span>
              <select
                aria-label="Tag to merge"
                value={mergingId ?? ""}
                onChange={(event) => setMergingId(event.target.value ? Number(event.target.value) : undefined)}
                className={selectClass}
              >
                <option value="">Choose a tag</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-[12px] font-bold text-ink3">
              <span className="mb-1 block">Into</span>
              <select
                aria-label="Merge into tag"
                value={mergeTarget}
                onChange={(event) => setMergeTarget(event.target.value ? Number(event.target.value) : "")}
                className={selectClass}
              >
                <option value="">Choose a tag</option>
                {tags
                  .filter((tag) => tag.id !== mergingId)
                  .map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
            <Btn
              variant="mint"
              disabled={!mergingId || !mergeTarget}
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
              <GitMerge size={15} aria-hidden="true" /> Merge
            </Btn>
          </div>
        </div>
      )}
    </section>
  );
}