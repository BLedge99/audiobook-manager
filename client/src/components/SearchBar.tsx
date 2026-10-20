import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { copy } from "../copy";
import { describeSearch, parseSearchQuery } from "../lib/search";

/**
 * Spec 22 -- the search input.
 *
 * Holds no matching logic of its own: it owns the text, and `lib/search.ts`
 * owns what it means. Mirrors `FilterBar`'s split so the two stay testable.
 *
 * There is no submit button. The field filters as you type, and a result count
 * in a `role="status"` is how the app tells you it heard you.
 */

const EXAMPLES = copy.search.examples;

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
    <section className="mb-5" aria-labelledby="search-bar">
      <h2 id="search-bar" className="sr-only">
        {copy.search.heading}
      </h2>

      <div className="panel panel--flat flex items-center gap-2.5 rounded-[24px_20px_24px_20px/20px_24px_20px_24px] px-4 py-2.5 focus-within:border-cobalt">
        <SearchIcon size={17} aria-hidden="true" className="shrink-0 text-ink3" />
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
          placeholder={copy.search.placeholder}
          aria-label={copy.search.label}
          aria-describedby="search-help"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink3"
        />
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label={copy.search.clear}
            className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink/25 text-ink2 transition hover:border-ink hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <p id="search-help" className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink3">
        {active ? (
          <span role="status" className="font-bold text-ink2">
            {copy.search.matches(resultCount)}{" "}
            <span className="text-cobalt-ink">{describeSearch(value)}</span>
          </span>
        ) : (
          <>
            <span className="font-bold">{copy.search.fields}</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setDraft(example)}
                className="rounded-full border border-ink/20 px-2 py-0.5 font-mono text-[12px] text-ink2 transition hover:border-ink hover:text-ink"
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