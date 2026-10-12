import { useEffect, useState } from "react";
import { Pencil, RotateCcw, Save } from "lucide-react";
import type { Audiobook, GenreNode, TagSummary } from "../types";
import type { useTagSuite } from "../useBrowse";

/**
 * Spec 20 — the full tag suite on the book detail screen.
 *
 * Every field is individually editable and shows its provenance: which values
 * are yours (an override, ADR 009) versus which came from a provider. The
 * whole suite saves in one request so an edit cannot half-apply.
 */

type Draft = Record<string, unknown>;

export function TagSuiteEditor({
  book,
  genres,
  tags,
  suite,
  onSaved,
}: {
  book: Audiobook;
  genres: GenreNode[];
  tags: TagSummary[];
  suite: ReturnType<typeof useTagSuite>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string>();

  // Re-seed the draft whenever the fetched suite changes.
  useEffect(() => {
    if (!suite.suite) return;
    setDraft({
      title: suite.suite.title,
      subtitle: suite.suite.subtitle ?? "",
      author: suite.suite.author,
      description: suite.suite.description ?? "",
      publisher: suite.suite.publisher ?? "",
      publishedYear: suite.suite.publishedYear ?? "",
      language: suite.suite.language ?? "",
      seriesName: suite.suite.series?.name ?? "",
      seriesPosition: suite.suite.series?.position ?? "",
      genreIds: suite.suite.genres.map((genre) => genre.id),
      tagIds: (book.customTags ?? []).map((tag) => tag.id),
    });
  }, [suite.suite, book.customTags]);

  if (!suite.suite) return null;

  const overridden = new Set(suite.suite.overriddenFields);
  const provenance = (field: string) =>
    overridden.has(field) ? "Yours" : (suite.suite!.metadataSource ?? "embedded");

  const save = async () => {
    setStatus(undefined);
    try {
      await suite.save({
        ...draft,
        publishedYear: draft.publishedYear === "" ? null : Number(draft.publishedYear),
        seriesPosition: draft.seriesPosition === "" ? null : Number(draft.seriesPosition),
      });
      setEditing(false);
      setStatus("Saved. These values now win over anything the providers suggest.");
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save");
    }
  };

  const Field = ({ label, field, placeholder }: { label: string; field: string; placeholder?: string }) => (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs uppercase tracking-widest text-slate-500">
        {label}
        {/* The provenance badge is decorative next to the field name. Without
            aria-hidden it is read as part of the label, so every input's
            accessible name became "Title embedded" instead of "Title". */}
        <span aria-hidden="true" className={overridden.has(field) ? "text-cyan-400" : "text-slate-600"}>
          {provenance(field)}
        </span>
      </span>
      {editing ? (
        <input
          aria-label={label}
          value={String(draft[field] ?? "")}
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
          placeholder={placeholder}
          className="w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
        />
      ) : (
        <p className="text-sm text-slate-200">{String(draft[field] ?? "") || <span className="text-slate-600">—</span>}</p>
      )}
    </label>
  );

  return (
    <section className="mt-6 border border-slate-800 bg-slate-900/50 p-4" aria-labelledby="tag-suite">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="tag-suite" className="text-sm font-semibold uppercase tracking-widest text-slate-400">Details</h2>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button type="button" onClick={() => { void save(); }} className="flex items-center gap-1 rounded bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300">
                <Save size={13} /> Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-1.5 text-xs text-slate-400">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400">
              <Pencil size={13} /> Edit
            </button>
          )}
          {overridden.size > 0 && (
            <button
              type="button"
              title="Clear your overrides so enrichment and embedded tags can update these again"
              onClick={() => void suite.reset().then(() => { setEditing(false); onSaved(); })}
              className="flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-amber-400"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {status && <p className="mb-3 text-xs text-cyan-300">{status}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" field="title" />
        <Field label="Author" field="author" />
        <Field label="Publisher" field="publisher" />
        <Field label="Year" field="publishedYear" />
        <Field label="Series" field="seriesName" placeholder="e.g. The Expanse" />
        <Field label="Series #" field="seriesPosition" placeholder="e.g. 2 or 2.5" />
        <Field label="Language" field="language" />
        <Field label="Subtitle" field="subtitle" />
      </div>

      {suite.suite.description !== undefined && (
        <div className="mt-4">
          <span className="mb-1 block text-xs uppercase tracking-widest text-slate-500">Description</span>
          {editing ? (
            <textarea
              value={String(draft.description ?? "")}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
            />
          ) : (
            <p className="text-sm leading-relaxed text-slate-300">{suite.suite.description || <span className="text-slate-600">—</span>}</p>
          )}
        </div>
      )}

      {suite.suite.contributors.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block text-xs uppercase tracking-widest text-slate-500">
            {suite.suite.contributors.filter((c) => c.role === "narrator").length > 0 ? "Narrators" : "Contributors"}
          </span>
          <ul className="flex flex-wrap gap-2">
            {suite.suite.contributors.map((contributor) => (
              <li key={`${contributor.id}-${contributor.role}`} className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-xs text-slate-300">
                {contributor.name}
                <span className="ml-1.5 text-slate-500">{contributor.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {genres.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-xs uppercase tracking-widest text-slate-500">Genres</legend>
          <div className="flex flex-wrap gap-2">
            {genres.flatMap((parent) => [parent, ...(parent.children ?? [])]).map((genre) => {
              const selected = ((draft.genreIds as number[]) ?? []).includes(genre.id);
              const count = suite.suite!.genres.filter((g) => g.id === genre.id).length;
              return (
                <button
                  key={genre.id}
                  type="button"
                  disabled={!editing}
                  aria-pressed={selected}
                  onClick={() =>
                    setDraft((current) => {
                      const ids = (current.genreIds as number[]) ?? [];
                      return {
                        ...current,
                        genreIds: ids.includes(genre.id) ? ids.filter((id) => id !== genre.id) : [...ids, genre.id],
                      };
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-cyan-400 bg-cyan-400 text-slate-950" : "border-slate-700 text-slate-400"} ${editing ? "" : "cursor-default"}`}
                >
                  {genre.name}
                  {count > 0 && <span className="ml-1 opacity-70">✓</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {tags.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-xs uppercase tracking-widest text-slate-500">Your tags</legend>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const selected = ((draft.tagIds as number[]) ?? []).includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={!editing}
                  aria-pressed={selected}
                  onClick={() =>
                    setDraft((current) => {
                      const ids = (current.tagIds as number[]) ?? [];
                      return {
                        ...current,
                        tagIds: ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id],
                      };
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-cyan-400 bg-cyan-400 text-slate-950" : "border-slate-700 text-slate-400"} ${editing ? "" : "cursor-default"}`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </section>
  );
}