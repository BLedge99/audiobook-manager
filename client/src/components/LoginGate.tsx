import { type FormEvent, useState } from "react";

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
        onSuccess();
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1117] text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm border border-slate-800 bg-slate-900 p-8">
        <h1 className="mb-1 text-xl font-bold">Audiobook Manager</h1>
        <p className="mb-6 text-sm text-slate-400">Enter the household password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Household password"
          className="mb-3 w-full border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
        />
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full bg-cyan-400 py-2 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
