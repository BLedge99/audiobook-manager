import { useEffect, useState } from "react";
import { Pencil, RotateCcw, Save } from "lucide-react";
import type { Audiobook, GenreNode, TagSummary } from "../types";
import type { useTagSuite } from "../useBrowse";
import { Btn, cn } from "../ui/primitives";

/**
 * Spec 20 -- the full tag suite on the book detail screen.
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
  const [original, setOriginal] = useState<Draft>({});
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string>();

  // Re-seed the draft whenever the fetched suite changes.
  useEffect(() => {
    if (!suite.suite) return;
    const seeded: Draft = {
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
    };
    setDraft(seeded);
    // Keep the untouched values so `save` can send only what the user actually
    // changed. Sending the whole draft made every field an override, which is
    // precisely the damage ADR 009 exists to prevent: editing a title silently
    // locked the publisher, year, series and description against the scanner
    // forever.
    setOriginal(seeded);
  }, [suite.suite, book.customTags]);

  if (!suite.suite) return null;

  const overridden = new Set(suite.suite.overriddenFields);
  const provenance = (field: string) =>
    overridden.has(field) ? "Yours" : (suite.suite!.metadataSource ?? "embedded");

  const save = async () => {
    setStatus(undefined);
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draft)) {
      const before = original[key];
      const same =
        Array.isArray(value) && Array.isArray(before)
          ? value.length === before.length && value.every((entry, index) => entry === before[index])
          : value === before;
      if (same) continue;
      changed[key] = value;
    }

    if (Object.keys(changed).length === 0) {
      setEditing(false);
      setStatus("Nothing changed.");
      return;
    }

    // Coerce the numeric fields, and send an explicit null rather than 0 when
    // cleared: `Number("")` is 0, which would store a year of zero.
    if ("publishedYear" in changed) {
      changed.publishedYear = changed.publishedYear === "" ? null : Number(changed.publishedYear);
    }
    if ("seriesPosition" in changed) {
      changed.seriesPosition = changed.seriesPosition === "" ? null : Number(changed.seriesPosition);
    }

    try {
      await suite.save(changed);
      setEditing(false);
      setStatus("Saved. These values now win over anything the providers suggest.");
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save");
    }
  };

  const Field = ({ label, field, placeholder }: { label: string; field: string; placeholder?: string }) => (
    <label className="block min-w-0">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-ink">{label}</span>
        {/* The provenance badge is decorative next to the field name. Without
            aria-hidden it is read as part of the label, so every input's
            accessible name became "Title embedded" instead of "Title". */}
        <span
          aria-hidden="true"
          className={cn("rounded-full border px-1.5 py-0.5 text-[10.5px] font-bold", overridden.has(field) ? "border-ink bg-rasp text-white" : "border-ink/25 text-ink3")}
        >
          {provenance(field)}
        </span>
      </span>
      {editing ? (
        <input
          aria-label={label}
          value={String(draft[field] ?? "")}
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
          placeholder={placeholder}
          className="field"
        />
      ) : (
        <p className="text-[14px] text-ink2">{String(draft[field] ?? "") || <span className="text-ink3">—</span>}</p>
      )}
    </label>
  );

  /** Genres and household tags are chosen with the same chip in both lists. */
  const ChoiceChip = ({
    selected,
    editing: isEditing,
    onClick,
    children,
  }: {
    selected: boolean;
    editing: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      disabled={!isEditing}
      aria-pressed={selected}
      onClick={onClick}
      className={cn("chip", selected && "bg-ink text-surface border-ink", !isEditing && "cursor-default")}
    >
      {children}
    </button>
  );

  return (
    <section className="panel mt-6 p-4 sm:p-5" aria-labelledby="tag-suite">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="tag-suite" className="font-display text-[17px] font-semibold text-ink">Details</h2>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Btn size="sm" variant="primary" onClick={() => { void save(); }}>
                <Save size={13} aria-hidden="true" /> Save
              </Btn>
              <Btn size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Btn>
            </>
          ) : (
            <Btn size="sm" onClick={() => setEditing(true)}>
              <Pencil size={13} aria-hidden="true" /> Edit
            </Btn>
          )}
          {overridden.size > 0 && (
            <Btn
              size="sm"
              variant="quiet"
              title="Clear your overrides so enrichment and embedded tags can update these again"
              onClick={() => void suite.reset().then(() => { setEditing(false); onSaved(); })}
            >
              <RotateCcw size={13} aria-hidden="true" /> Reset
            </Btn>
          )}
        </div>
      </div>

      {status && <p role="status" className="mb-3 text-[12.5px] font-bold text-cobalt-ink">{status}</p>}

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
          <span className="mb-1 block text-[13px] font-bold text-ink">Description</span>
          {editing ? (
            <textarea
              aria-label="Description"
              value={String(draft.description ?? "")}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="field min-h-24 rounded-[22px_18px_22px_18px/18px_22px_18px_22px] py-2.5"
            />
          ) : (
            <p className="text-[14px] leading-relaxed text-ink2">
              {suite.suite.description || <span className="text-ink3">—</span>}
            </p>
          )}
        </div>
      )}

      {suite.suite.contributors.length > 0 && (
        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-bold text-ink">
            {suite.suite.contributors.filter((c) => c.role === "narrator").length > 0 ? "Narrators" : "Contributors"}
          </span>
          <ul className="flex flex-wrap gap-2">
            {suite.suite.contributors.map((contributor) => (
              <li
                key={`${contributor.id}-${contributor.role}`}
                className="rounded-full border-2 border-ink/25 bg-sunk px-3 py-1 text-[12px] font-semibold text-ink2"
              >
                {contributor.name}
                <span className="ml-1.5 text-ink3">{contributor.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {genres.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 font-display text-[15px] font-semibold text-ink">Genres</legend>
          <div className="flex flex-wrap gap-2">
            {genres.flatMap((parent) => [parent, ...(parent.children ?? [])]).map((genre) => {
              const selected = ((draft.genreIds as number[]) ?? []).includes(genre.id);
              const count = suite.suite!.genres.filter((g) => g.id === genre.id).length;
              return (
                <ChoiceChip
                  key={genre.id}
                  selected={selected}
                  editing={editing}
                  onClick={() =>
                    setDraft((current) => {
                      const ids = (current.genreIds as number[]) ?? [];
                      return {
                        ...current,
                        genreIds: ids.includes(genre.id) ? ids.filter((id) => id !== genre.id) : [...ids, genre.id],
                      };
                    })
                  }
                >
                  {genre.name}
                  {count > 0 && <span className="ml-1 opacity-70">✓</span>}
                </ChoiceChip>
              );
            })}
          </div>
        </fieldset>
      )}

      {tags.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 font-display text-[15px] font-semibold text-ink">Your tags</legend>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const selected = ((draft.tagIds as number[]) ?? []).includes(tag.id);
              return (
                <ChoiceChip
                  key={tag.id}
                  selected={selected}
                  editing={editing}
                  onClick={() =>
                    setDraft((current) => {
                      const ids = (current.tagIds as number[]) ?? [];
                      return {
                        ...current,
                        tagIds: ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id],
                      };
                    })
                  }
                >
                  {tag.name}
                </ChoiceChip>
              );
            })}
          </div>
        </fieldset>
      )}
    </section>
  );
}