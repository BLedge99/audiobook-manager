import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { describeSearch, parseSearchQuery } from "../lib/search";

/**
 * Spec 22 — the search input.
 *
 * Holds no matching logic of its own: it owns the text, and `lib/search.ts`
 * owns what it means. Mirrors `FilterBar`'s split so the two stay testable.
 */

const EXAMPLES = ["author: rowling", "genre: thriller", "narrator: fry", "tag: bedtime"];

export function SearchBar({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adopt an external change (back/forward navigation, "clear") without
  // stomping on what the user is currently typing.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Debounce so a fast typist does not re-filter the whole library per keypress.
  // The ref holds the timer so an unmount cancels it.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(draft);
    }, 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `value` is intentionally not a dependency: this effect fires on typing.
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseSearchQuery(value);
  const active = !parsed.empty;

  return (
    <section className="mb-4" aria-labelledby="search-bar">
      <h2 id="search-bar" className="sr-only">
        Search the library
      </h2>
      <div className="flex items-center gap-2 border border-slate-800 bg-slate-900/50 px-3 py-2 focus-within:border-cyan-500">
        <SearchIcon size={16} aria-hidden="true" className="shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft("");
              onChange("");
            }
          }}
          placeholder="Search — try author: rowling or genre: thriller"
          aria-label="Search the library"
          aria-describedby="search-help"
          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
        />
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="shrink-0 text-slate-500 hover:text-slate-200"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <p id="search-help" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {active ? (
          <span role="status">
            {resultCount} {resultCount === 1 ? "match" : "matches"} for{" "}
            <span className="text-cyan-400">{describeSearch(value)}</span>
          </span>
        ) : (
          <>
            <span>Fields:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setDraft(example)}
                className="font-mono text-slate-400 hover:text-cyan-400"
              >
                {example}
              </button>
            ))}
          </>
        )}
      </p>
    </section>
  );
}