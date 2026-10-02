import path from "node:path";

export interface EnrichmentCandidate {
  source: "openlibrary" | "googlebooks";
  title: string;
  author?: string;
  coverUrl?: string;
  description?: string;
  confidence: number;
  raw: unknown;
}

function similarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const aWords = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((word) => aWords.has(word)).length;
  return Math.min(1, overlap / Math.max(aWords.size, nb.split(" ").length));
}

export async function searchOpenLibrary(title: string, author?: string): Promise<EnrichmentCandidate[]> {
  const query = encodeURIComponent([title, author].filter(Boolean).join(" "));
  const res = await fetch(`https://openlibrary.org/search.json?q=${query}&limit=5`);
  if (!res.ok) return [];
  const data = (await res.json()) as { docs?: Record<string, unknown>[] };
  return (data.docs ?? []).slice(0, 5).map((doc) => ({
    source: "openlibrary" as const,
    title: String(doc.title ?? "Unknown"),
    author: Array.isArray(doc.author_name) ? String(doc.author_name[0]) : undefined,
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
    description: undefined,
    confidence: similarity(title, String(doc.title ?? "")),
    raw: doc,
  }));
}

export async function searchGoogleBooks(title: string, author?: string): Promise<EnrichmentCandidate[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const query = encodeURIComponent([title, author].filter(Boolean).join(" "));
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5${key ? `&key=${key}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: { volumeInfo?: Record<string, unknown> }[] };
  return (data.items ?? []).slice(0, 5).map((item) => {
    const info = item.volumeInfo ?? {};
    const imageLinks = info.imageLinks as { thumbnail?: string } | undefined;
    return {
      source: "googlebooks" as const,
      title: String(info.title ?? "Unknown"),
      author: Array.isArray(info.authors) ? String(info.authors[0]) : undefined,
      coverUrl: imageLinks?.thumbnail?.replace(/^http:/, "https:"),
      description: typeof info.description === "string" ? info.description : undefined,
      confidence: similarity(title, String(info.title ?? "")),
      raw: item,
    };
  });
}

export function candidateCoverFilename(source: string, id: number): string {
  return `${source}_${id}_${Date.now()}.jpg`;
}

export const COVER_DIR = process.env.COVER_DIR || "/app/data/covers";

export async function downloadCover(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}
