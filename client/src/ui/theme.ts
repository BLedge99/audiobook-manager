import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "auto";

const KEY = "bookle-theme";

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

export function readTheme(): ThemeChoice {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

/**
 * Writes the choice to `<html data-theme>` and the document's colour-scheme.
 *
 * "auto" removes the attribute entirely rather than setting one of the two, so
 * the CSS `@media (prefers-color-scheme: dark)` block in index.css takes over
 * and keeps following the system without JavaScript running.
 */
export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function resolvedTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "auto") return choice;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * Theme state, synced across tabs.
 *
 * index.html applies the stored choice in an inline script before first paint,
 * so this hook only has to keep `<html>` in step afterwards -- otherwise a
 * returning user gets a white flash on a dark phone.
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolvedTheme(readTheme()));

  useEffect(() => {
    applyTheme(choice);
    setResolved(resolvedTheme(choice));
    if (choice !== "auto") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      setChoiceState(readTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    if (next === "auto") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  }, []);

  return { choice, setChoice, resolved };
}

/**
 * Whether to spend GPU on the decorative layer.
 *
 * The target host is a Raspberry Pi class machine reached through a phone, and
 * the Android WebView on older devices, so the ambient field and the particle
 * burst are skipped when the device is visibly underpowered or the listener has
 * asked for reduced motion.
 */
export function useLightEffects() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const cores = navigator.hardwareConcurrency ?? 4;
    setOk(!reduced && cores >= 4);
  }, []);
  return ok;
}