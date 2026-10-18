import { type FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { setSessionToken } from "../lib/api";
import { Btn, Field, FullScreen, Wordmark } from "../ui/primitives";

export function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password");
      } else {
        // The Android shell cannot rely on the session cookie (cross-scheme,
        // so SameSite=Lax is dropped), so the token comes back in the body and
        // is replayed as a header. Harmless in the browser, which uses the
        // cookie; `setSessionToken` ignores the "disabled" sentinel.
        const body = (await res.json().catch(() => undefined)) as { token?: string } | undefined;
        setSessionToken(body?.token === "disabled" ? undefined : body?.token);
        onSuccess();
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title="Audiobook Manager" subtitle="local-first listening" />

        <form onSubmit={submit} className="panel mt-8 w-full max-w-sm px-6 py-7">
          <h1 className="font-display text-2xl font-semibold text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink2">Enter the household password to continue.</p>

          <label htmlFor="household-password" className="sr-only">
            Household password
          </label>
          <Field
            id="household-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Household password"
            autoComplete="current-password"
            className="mt-5"
          />

          {/* role="alert" so the message interrupts a screen reader rather than
              being discovered by accident after the listener has moved on. */}
          {error && (
            <p role="alert" className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink">
              {error}
            </p>
          )}

          <Btn type="submit" variant="primary" disabled={busy} className="mt-4 w-full">
            <KeyRound size={17} aria-hidden="true" />
            {busy ? "Checking…" : "Sign in"}
          </Btn>
        </form>
      </div>
    </FullScreen>
  );
}