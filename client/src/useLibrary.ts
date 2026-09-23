import { useCallback, useEffect, useState } from "react";
import type { Audiobook, LibraryRoot } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = options?.body ? { "Content-Type": "application/json" } : undefined;
  const response = await fetch(url, { ...options, ...(headers ? { headers } : {}) });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try { message = JSON.parse(body).message || body; } catch { }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function useLibrary() {
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [books, libraryRoots] = await Promise.all([
        request<Audiobook[]>("/api/audiobooks"),
        request<LibraryRoot[]>("/api/library-roots"),
      ]);
      setAudiobooks(books);
      setRoots(libraryRoots);
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addRoot = async (path: string, label: string) => {
    await request<LibraryRoot>("/api/library-roots", { method: "POST", body: JSON.stringify({ path, label }) });
    await refresh();
  };

  const removeRoot = async (id: number) => {
    await request<void>(`/api/library-roots/${id}`, { method: "DELETE" });
    await refresh();
  };

  const scan = async (rootId?: number) => {
    await request("/api/scan", { method: "POST", body: JSON.stringify(rootId ? { rootId } : {}) });
    await refresh();
  };

  useEffect(() => {
    if (!roots.some((root) => root.scanState?.status === "scanning")) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [roots, refresh]);

  return { audiobooks, roots, loading, error, refresh, addRoot, removeRoot, scan };
}