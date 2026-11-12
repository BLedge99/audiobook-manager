/**
 * Spec 38 — the operator screens for kids accounts and age ratings.
 *
 * The family app never creates or edits a kids account and never sets a
 * confirmed rating; those live here, behind the admin-panel credential.
 * Strings come from `copyAdmin` only.
 */
import React from "react";
import { copyAdmin } from "./copy";
import { adminRequest, AdminRequestError } from "./request";

const LADDER = [0, 4, 7, 9, 12, 16] as const;
const AGE_BANDS = ["under-6", "6-9", "10-13", "14-17"] as const;

export type KidSummary = {
  id: number;
  name: string;
  color: string | null;
  ageBand: string | null;
  followsServerLibrary: boolean;
  disabled: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  libraryCount: number;
};

function bandLabel(band: string | null): string {
  switch (band) {
    case "under-6": return copyAdmin.kids.bandUnder6;
    case "6-9": return copyAdmin.kids.band69;
    case "10-13": return copyAdmin.kids.band1013;
    case "14-17": return copyAdmin.kids.band1417;
    default: return copyAdmin.ratings.unrated;
  }
}

export function KidsAccounts() {
  const [kids, setKids] = React.useState<KidSummary[] | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [name, setName] = React.useState("");
  const [band, setBand] = React.useState<string>("under-6");
  const [password, setPassword] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<number | null>(null);
  const [resetPassword, setResetPassword] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setKids(await adminRequest<KidSummary[]>("/api/admin/kids-accounts"));
      setError("");
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? copyAdmin.kids.loadFailed : copyAdmin.kids.loadFailed);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function run(task: () => Promise<void>) {
    setWorking(true);
    setNotice("");
    try {
      await task();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copyAdmin.kids.updateFailed);
    } finally {
      setWorking(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || password.length === 0) return;
    await run(async () => {
      await adminRequest("/api/admin/kids-accounts", { method: "POST", body: { name: trimmed, ageBand: band, password } });
      setName("");
      setPassword("");
      setBand("under-6");
      await load();
    });
  }

  async function patch(id: number, body: Partial<{ ageBand: string; disabled: boolean }>) {
    await run(async () => {
      await adminRequest(`/api/admin/kids-accounts/${id}`, { method: "PATCH", body });
      await load();
    });
  }

  async function reset(id: number) {
    const trimmed = resetPassword.trim();
    if (!trimmed) return;
    await run(async () => {
      await adminRequest(`/api/admin/kids-accounts/${id}/reset-password`, { method: "POST", body: { newPassword: trimmed } });
      setResetFor(null);
      setResetPassword("");
      setNotice(copyAdmin.kids.resetPasswordDone);
      await load();
    });
  }

  async function fillShelf(kid: KidSummary) {
    await run(async () => {
      const result = await adminRequest<{ added: number }>(`/api/admin/kids-accounts/${kid.id}/fill-shelf`, { method: "POST" });
      setNotice(result.added === 1 ? copyAdmin.kids.fillShelfDoneOne(result.added) : copyAdmin.kids.fillShelfDoneMany(result.added));
      await load();
    });
  }

  async function removeKid(kid: KidSummary) {
    if (!window.confirm(copyAdmin.kids.deleteConfirm(kid.name))) return;
    await run(async () => {
      await adminRequest(`/api/admin/kids-accounts/${kid.id}`, { method: "DELETE" });
      await load();
    });
  }

  if (kids === null) return <p>{copyAdmin.kids.loading}</p>;
  return <div className="kids-admin">
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="good">{notice}</p>}

    <section className="card">
      <h2>{copyAdmin.kids.createHeading}</h2>
      <p>{copyAdmin.kids.explainer}</p>
      <form className="kids-create" onSubmit={(event) => void create(event)}>
        <label>{copyAdmin.kids.nameLabel}<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={copyAdmin.kids.namePlaceholder} /></label>
        <label>{copyAdmin.kids.bandLabel}<select value={band} onChange={(event) => setBand(event.target.value)}>
          {AGE_BANDS.map((value) => <option key={value} value={value}>{bandLabel(value)}</option>)}
        </select></label>
        <label>{copyAdmin.kids.passwordLabel}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" /></label>
        <p className="hint">{copyAdmin.kids.passwordHint}</p>
        <button type="submit" disabled={working}>{copyAdmin.kids.submitCreate}</button>
      </form>
    </section>

    <section className="card">
      <h2>{copyAdmin.kids.listHeading}</h2>
      {kids.length === 0 && <p>{copyAdmin.kids.empty}</p>}
      {kids.map((kid) => <article key={kid.id} className="kids-row">
        <div>
          <strong>{kid.name}</strong>
          <p>{copyAdmin.kids.shelfCount(kid.libraryCount)}</p>
          <p>{kid.lastActiveAt ? copyAdmin.kids.lastActive(new Date(kid.lastActiveAt).toLocaleDateString()) : copyAdmin.kids.neverActive}</p>
          <span className={kid.disabled ? "bad" : "good"}>{kid.disabled ? copyAdmin.kids.disabledLabel : copyAdmin.kids.activeLabel}</span>
        </div>
        <label>{copyAdmin.kids.bandLabel}
          <select value={kid.ageBand ?? "under-6"} disabled={working} onChange={(event) => void patch(kid.id, { ageBand: event.target.value })}>
            {AGE_BANDS.map((value) => <option key={value} value={value}>{bandLabel(value)}</option>)}
          </select>
        </label>
        <div className="root-buttons">
          <button className="secondary" disabled={working} onClick={() => void patch(kid.id, { disabled: !kid.disabled })}>{kid.disabled ? copyAdmin.kids.enable : copyAdmin.kids.disable}</button>
          <button className="secondary" disabled={working} onClick={() => void fillShelf(kid)}>{copyAdmin.kids.fillShelf}</button>
          <button className="secondary" disabled={working} onClick={() => { setResetFor(resetFor === kid.id ? null : kid.id); setResetPassword(""); }}>{copyAdmin.kids.resetPassword}</button>
          <button className="danger" disabled={working} onClick={() => void removeKid(kid)}>{copyAdmin.kids.deleteButton}</button>
        </div>
        {resetFor === kid.id && <form className="kids-reset" onSubmit={(event) => { event.preventDefault(); void reset(kid.id); }}>
          <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder={copyAdmin.kids.confirmPasswordPlaceholder} required minLength={8} autoComplete="new-password" />
          <button type="submit" disabled={working}>{copyAdmin.kids.savePassword}</button>
        </form>}
      </article>)}
    </section>
  </div>;
}

type AdminBook = {
  id: number;
  title: string;
  author: string | null;
  publishedYear: number | null;
  minimumAge: number | null;
  suggestedMinimumAge: number | null;
  suggestedMinimumAgeSource: string | null;
};

type AdminGenre = {
  id: number;
  slug: string;
  name: string;
  parentId: number | null;
  count: number;
  blocked: boolean;
};

export function AgeRatings() {
  const [q, setQ] = React.useState("");
  const [books, setBooks] = React.useState<AdminBook[] | null>(null);
  const [genres, setGenres] = React.useState<AdminGenre[]>([]);
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);

  const loadBooks = React.useCallback(async (query: string) => {
    try {
      const result = await adminRequest<{ books: AdminBook[] }>(`/api/admin/age-ratings/books${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      setBooks(result.books);
      setError("");
    } catch (cause) {
      setError(cause instanceof AdminRequestError ? copyAdmin.ratings.loadFailed : copyAdmin.ratings.loadFailed);
    }
  }, []);
  const loadGenres = React.useCallback(async () => {
    try {
      const result = await adminRequest<{ genres: AdminGenre[] }>("/api/admin/genre-blocklist");
      setGenres(result.genres);
    } catch {
      setError(copyAdmin.ratings.blocklistFailed);
    }
  }, []);

  React.useEffect(() => {
    const handle = window.setTimeout(() => { void loadBooks(q); }, 250);
    return () => window.clearTimeout(handle);
  }, [q, loadBooks]);
  React.useEffect(() => { void loadGenres(); }, [loadGenres]);

  async function mutate(task: () => Promise<void>) {
    setWorking(true);
    try {
      await task();
      setError("");
    } catch {
      setError(copyAdmin.ratings.saveFailed);
    } finally {
      setWorking(false);
    }
  }

  async function setRating(book: AdminBook, age: number | null) {
    await mutate(async () => {
      const updated = await adminRequest<Partial<AdminBook> & { id: number }>("/api/admin/age-ratings/set", {
        method: "POST",
        body: { mediaItemId: book.id, minimumAge: age },
      });
      setBooks((current) => (current ?? []).map((row) => (row.id === book.id ? { ...row, minimumAge: updated.minimumAge ?? null } : row)));
    });
  }

  async function resolveSuggestion(book: AdminBook, action: "confirm" | "dismiss") {
    await mutate(async () => {
      await adminRequest(`/api/admin/age-ratings/${action}`, { method: "POST", body: { mediaItemId: book.id } });
      await loadBooks(q);
    });
  }

  async function toggleGenre(genre: AdminGenre) {
    await mutate(async () => {
      if (genre.blocked) await adminRequest(`/api/admin/genre-blocklist/${genre.id}`, { method: "DELETE" });
      else await adminRequest("/api/admin/genre-blocklist", { method: "POST", body: { genreId: genre.id } });
      await loadGenres();
    });
  }

  return <div className="ratings-admin">
    {error && <p role="alert" className="error">{error}</p>}

    <section className="card">
      <h2>{copyAdmin.ratings.heading}</h2>
      <p>{copyAdmin.ratings.explainer}</p>
      <label>{copyAdmin.ratings.searchLabel}<input value={q} onChange={(event) => setQ(event.target.value)} placeholder={copyAdmin.ratings.searchPlaceholder} /></label>
      {books === null && <p>{copyAdmin.ratings.loading}</p>}
      {books !== null && books.length === 0 && <p>{copyAdmin.ratings.empty}</p>}
      {books?.map((book) => <article key={book.id} className="ratings-row">
        <div>
          <strong>{book.title}</strong>
          <p>{book.author ? copyAdmin.ratings.titleAuthor(book.title, book.author) : book.title}</p>
          <p>{book.suggestedMinimumAge !== null && book.suggestedMinimumAgeSource ? copyAdmin.ratings.suggestionBadge(book.suggestedMinimumAge, book.suggestedMinimumAgeSource) : copyAdmin.ratings.unrated}</p>
        </div>
        <div className="root-buttons" role="group" aria-label={book.title}>
          {LADDER.map((age) => (
            <button
              key={age}
              className={book.minimumAge === age ? "" : "secondary"}
              disabled={working}
              onClick={() => void setRating(book, age)}
            >{copyAdmin.ratings.ladder(age)}</button>
          ))}
          <button className="secondary" disabled={working} onClick={() => void setRating(book, null)}>{copyAdmin.ratings.clear}</button>
          {book.suggestedMinimumAge !== null && <>
            <button className="secondary" disabled={working} onClick={() => void resolveSuggestion(book, "confirm")}>{copyAdmin.ratings.confirm}</button>
            <button className="secondary" disabled={working} onClick={() => void resolveSuggestion(book, "dismiss")}>{copyAdmin.ratings.dismiss}</button>
          </>}
        </div>
      </article>)}
    </section>

    <section className="card">
      <h2>{copyAdmin.ratings.blocklistHeading}</h2>
      <p>{copyAdmin.ratings.blocklistExplainer}</p>
      <ul>
        {genres.map((genre) => <li key={genre.id}>
          <button
            className={genre.blocked ? "danger" : "secondary"}
            disabled={working}
            aria-label={genre.blocked ? copyAdmin.ratings.hideGenre(genre.name) : copyAdmin.ratings.showGenre(genre.name)}
            onClick={() => void toggleGenre(genre)}
          >{genre.name}</button>
          <small>{copyAdmin.ratings.shelfCount(genre.count)}</small>
        </li>)}
      </ul>
    </section>
  </div>;
}
