/**
 * External items (spec 39) — the "Get this book" affordance sheet state.
 * Extracted from App.tsx (spec 43 phase 6.2); behaviour unchanged.
 */
import { useCallback, useState } from "react";
import type { ExternalItem } from "../local/db";
import { EXTERNAL_STORES } from "./externalStores";
import { launchStoreLink } from "./externalIntent";
import { useExternalItems } from "../local/useExternalItems";

export function useExternalSheet() {
  const {
    items,
    add: addExternalRaw,
    remove: removeExternalRaw,
  } = useExternalItems();
  const [addExternalOpen, setAddExternalOpen] = useState(false);
  /** Set when every launch rung failed — the listener deserves an answer, not silence. */
  const [externalLaunchFailed, setExternalLaunchFailed] = useState(false);

  const openExternal = useCallback((item: ExternalItem) => {
    const def = EXTERNAL_STORES[item.store];
    void launchStoreLink(item.httpsUrl, { packageName: def.packageName }).then((ok) => {
      setExternalLaunchFailed(!ok);
    });
  }, []);

  const removeExternal = useCallback(
    async (id: string) => {
      await removeExternalRaw(id);
    },
    [removeExternalRaw],
  );

  const addExternal = useCallback(
    (url: string, overrides: { title?: string; author?: string | null }) =>
      addExternalRaw(url, overrides),
    [addExternalRaw],
  );

  return {
    items,
    addExternalOpen,
    setAddExternalOpen,
    externalLaunchFailed,
    openExternal,
    removeExternal,
    addExternal,
  };
}
