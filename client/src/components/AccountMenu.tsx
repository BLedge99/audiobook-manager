import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { copy } from "../copy";
import { lockSession, type SessionInfo } from "../lib/api";
import { Btn } from "../ui/primitives";

export function AccountMenu({ session }: { session: SessionInfo | null }) {
  const [open, setOpen] = useState(false);
  const identity = session?.profile?.email || copy.account.demoAccount;

  const signOut = async () => {
    await lockSession();
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
        </div>
      )}
    </div>
  );
}
