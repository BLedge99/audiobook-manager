import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { copy } from "../copy";
import { boundedFetch, lockSession, setActiveProfileId, setSessionToken, type SessionInfo } from "../lib/api";
import { Btn } from "../ui/primitives";

export function AccountMenu({ session }: { session: SessionInfo | null }) {
  const [open, setOpen] = useState(false);
  const identity = session?.profile?.email || copy.account.demoAccount;

  const signOut = async () => {
    await lockSession();
    window.location.reload();
  };

  const exportMyData = async () => {
    try {
      const res = await boundedFetch("/api/me/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silent failure: the export is a convenience, not a blocking action.
    }
  };

  const deleteMyAccount = async () => {
    if (!window.confirm("Deleting your account erases all your data — progress, favourites, wishlist, library — and cannot be undone. Continue?")) return;
    try {
      const res = await boundedFetch("/api/me", { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      // Even if the server call fails, clear local state so the account is gone from this device.
    }
    setSessionToken(null);
    setActiveProfileId(null);
    window.location.reload();
  };

  return (
    <div className="relative">
      <Btn
        variant="quiet"
        size="sm"
        aria-label={copy.account.accountMenu}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <UserRound size={16} aria-hidden="true" />
        <span className="hidden max-w-40 truncate sm:inline">{identity}</span>
      </Btn>
      {open && (
        <div className="panel absolute right-0 top-full z-50 mt-2 grid min-w-48 gap-2 p-3">
          <p className="max-w-56 truncate px-2 py-1 text-sm font-bold text-ink" title={identity}>{identity}</p>
          <Btn variant="quiet" size="sm" onClick={() => void signOut()}>
            <LogOut size={15} aria-hidden="true" />
            {copy.account.signOut}
          </Btn>
          <a
            href="/privacy"
            className="block w-full text-left text-sm font-bold text-cobalt-ink underline decoration-1 underline-offset-2 px-2 py-2 rounded-xl hover:bg-ink2/10"
          >
            {copy.privacy.link}
          </a>
          <Btn
            variant="quiet"
            size="sm"
            onClick={exportMyData}
            className="w-full text-left"
          >
            {copy.privacy.export}
          </Btn>
          <Btn
            variant="quiet"
            size="sm"
            onClick={deleteMyAccount}
            className="w-full text-left text-rasp-ink"
          >
            {copy.privacy.erase}
          </Btn>
        </div>
      )}
    </div>
  );
}
