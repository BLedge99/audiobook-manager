/**
 * React state for the device-local external shelf (spec 39).
 *
 * Mirror of `useDeviceLibrary` in shape; deliberately not a sync of anything.
 * Dependencies: the database and nothing else — no API client, ever.
 */
import { useCallback, useEffect, useState } from "react";
import type { ExternalItem, LocalLibraryDatabase } from "./db";
import { localDb } from "./db";
import {
  addExternalItem,
  listExternalItems,
  removeExternalItem,
  type AddExternalResult,
} from "./externalItems";

export function useExternalItems(db: LocalLibraryDatabase = localDb) {
  const [items, setItems] = useState<ExternalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setItems(await listExternalItems(db));
    setLoading(false);
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (rawUrl: string, overrides?: { title?: string; author?: string | null }): Promise<AddExternalResult> => {
      const result = await addExternalItem(db, rawUrl, overrides);
      if (result.ok) await reload();
      return result;
    },
    [db, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeExternalItem(db, id);
      await reload();
    },
    [db, reload],
  );

  return { items, loading, add, remove, reload };
}
