import { boundedFetch } from "./api";

export interface PasskeySummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}

export interface PasskeyLoginResult {
  token?: string;
  authDisabled?: boolean;
  profile?: { id: number; name: string };
}

export class PasskeyError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "PasskeyError";
  }
}

async function failure(response: Response): Promise<PasskeyError> {
  let code = "request_failed";
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    /* a non-JSON failure still has a status */
  }
  return new PasskeyError(code, response.status);
}

/**
 * True when this page can run a WebAuthn ceremony at all. Windows Hello needs
 * a secure context, and `localhost` is the one permitted exception in dev.
 */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

/** Sign in with a passkey for a chosen profile. */
export async function signInWithPasskey(profileId: number): Promise<PasskeyLoginResult> {
  const optionsResponse = await boundedFetch("/api/auth/passkeys/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  if (!optionsResponse.ok) throw await failure(optionsResponse);

  const { startAuthentication } = await import("@simplewebauthn/browser");
  const response = await startAuthentication({
    optionsJSON: await optionsResponse.json(),
  });

  const verifyResponse = await boundedFetch("/api/auth/passkeys/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  });
  if (!verifyResponse.ok) throw await failure(verifyResponse);
  return (await verifyResponse.json()) as PasskeyLoginResult;
}

/** Register the current device's Windows Hello / platform authenticator. */
export async function addPasskey(label?: string): Promise<PasskeySummary> {
  const optionsResponse = await boundedFetch("/api/auth/passkeys/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!optionsResponse.ok) throw await failure(optionsResponse);

  const { startRegistration } = await import("@simplewebauthn/browser");
  const response = await startRegistration({
    optionsJSON: await optionsResponse.json(),
  });

  const verifyResponse = await boundedFetch("/api/auth/passkeys/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response, label }),
  });
  if (!verifyResponse.ok) throw await failure(verifyResponse);
  const body = (await verifyResponse.json()) as { credential: PasskeySummary };
  return body.credential;
}

export async function listPasskeys(): Promise<{
  configured: boolean;
  passkeys: PasskeySummary[];
}> {
  const response = await boundedFetch("/api/auth/passkeys");
  if (!response.ok) throw await failure(response);
  return (await response.json()) as { configured: boolean; passkeys: PasskeySummary[] };
}

export async function removePasskey(id: string): Promise<void> {
  const response = await boundedFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw await failure(response);
}
