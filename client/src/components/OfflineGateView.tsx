/**
 * Spec 43 phase 6.2 — the offline gate rendered.
 *
 * The offline branch used to be a switch inside App.tsx; the decision itself
 * stays in `lib/offlineGate.ts` (the tested contract, spec 29). This file is
 * only the JSX for whichever screen that contract picked. `null` means
 * "shell": render the normal app offline.
 */
import { Splash, OfflineNotice } from "./OfflineNotice";
import { OfflineUnlock } from "./OfflineUnlock";
import type { OfflineScreen } from "../lib/offlineGate";

export interface OfflineGateViewProps {
  screen: OfflineScreen;
  /** Whether the device has books — drives the libraryReadFailed notice copy. */
  hasBooks: boolean;
  onRetry: () => void;
  onChangeServer: () => void;
  onUnlocked: () => void;
  /** "Listen without progress" — progress stays hidden until a real unlock. */
  onListenWithoutProgress: () => void;
}

export function OfflineGateView({
  screen,
  hasBooks,
  onRetry,
  onChangeServer,
  onUnlocked,
  onListenWithoutProgress,
}: OfflineGateViewProps) {
  switch (screen.kind) {
    case "waiting":
      return <Splash />;
    case "libraryReadFailed":
      return (
        <OfflineNotice hasBooks={hasBooks} libraryReadFailed onRetry={onRetry} onChangeServer={onChangeServer} />
      );
    case "unlock":
      return (
        <OfflineUnlock
          onUnlocked={onUnlocked}
          onChangeServer={onChangeServer}
          onListenWithoutProgress={onListenWithoutProgress}
        />
      );
    case "browserNotice":
      return <OfflineNotice hasBooks={false} onRetry={onRetry} onChangeServer={onChangeServer} />;
    case "shell":
      return null;
  }
}
