import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, WebAuthnCredential } from "@prisma/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { fail } from "../http-errors";
import type { AuthService, AuthContext, SessionMetadata } from "./service";
import { AuthFailure } from "./service";
import { deviceLabelFromUserAgent } from "./session";
import {
  loginPayload,
  sendAuthFailure,
  setSessionCookie,
  type RegisterAuthOptions,
} from "./routes";

/** Five minutes, per spec 28. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type ChallengeType = "registration" | "authentication";

export interface PasskeyConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

/**
 * Read the WebAuthn configuration from the environment. Passkeys are optional:
 * without both values the routes answer `passkey_not_configured` rather than
 * failing obscurely in the browser.
 */
export function passkeyConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PasskeyConfig | null {
  const rpId = env.WEBAUTHN_RP_ID?.trim();
  const origin = env.WEBAUTHN_ORIGIN?.trim();
  if (!rpId || !origin) return null;

  const origins = origin
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (origins.length === 0) return null;

  return {
    rpId,
    rpName: env.WEBAUTHN_RP_NAME?.trim() || "Bookle",
    origins,
  };
}

/**
 * A WebAuthn counter is only useful when the authenticator reports one. Most
 * platform authenticators (Windows Hello included) always report 0, so a zero
 * must never be read as a clone.
 */
export function isCounterRegression(stored: number, reported: number): boolean {
  return stored > 0 && reported > 0 && reported <= stored;
}

export function defaultCredentialLabel(userAgent: string | null | undefined): string {
  return userAgent && /windows/i.test(userAgent) ? "Windows Hello" : "Passkey";
}

interface ClientData {
  challenge?: unknown;
}

/** The challenge lives inside the signed client data, not in a request field. */
export function challengeFromClientData(clientDataJSON: string): string | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(clientDataJSON, "base64url").toString("utf8"),
    ) as ClientData;
    return typeof parsed.challenge === "string" && parsed.challenge.length > 0
      ? parsed.challenge
      : null;
  } catch {
    return null;
  }
}

export interface PasskeyServiceOptions {
  prisma: PrismaClient;
  config: PasskeyConfig | null;
  now?: () => Date;
}

interface StoredPublicKey {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
}

export function storedCredentialToVerificationInput(
  credential: Pick<WebAuthnCredential, "credentialId" | "publicKey" | "counter" | "transports">,
): StoredPublicKey & { counter: number; transports?: string[] } {
  let transports: string[] | undefined;
  if (credential.transports) {
    try {
      const parsed = JSON.parse(credential.transports) as unknown;
      if (Array.isArray(parsed)) {
        transports = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      /* a malformed stored row is treated as "no transports" */
    }
  }
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
    counter: credential.counter,
    transports,
  };
}

/**
 * WebAuthn ceremonies (spec 28, phase 6).
 *
 * Passkeys are additive and web-only: every profile keeps a password because
 * the Android app uses the native biometric sensor instead. A successful
 * assertion creates an ordinary profile session; it is never a second factor.
 */
export class PasskeyService {
  readonly enabled: boolean;
  private readonly prisma: PrismaClient;
  private readonly config: PasskeyConfig | null;
  private readonly now: () => Date;

  constructor(options: PasskeyServiceOptions) {
    this.prisma = options.prisma;
    this.config = options.config;
    this.enabled = options.config !== null;
    this.now = options.now ?? (() => new Date());
  }

  async registrationOptions(profileId: number) {
    const config = this.assertConfigured();
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");

    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { profileId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: new TextEncoder().encode(`profile-${profile.id}`),
      userName: profile.name,
      userDisplayName: profile.name,
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: parseTransports(credential.transports),
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    await this.storeChallenge(options.challenge, "registration", profileId);
    return options;
  }

  async verifyRegistration(
    profileId: number,
    response: RegistrationResponseJSON,
    label: string | null | undefined,
    userAgent: string | null | undefined,
  ) {
    const config = this.assertConfigured();
    const challenge = this.challengeOf(response.response.clientDataJSON);
    await this.consumeChallenge(challenge, "registration", profileId);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new AuthFailure(401, "passkey_failed");
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new AuthFailure(401, "passkey_failed");
    }

    const info = verification.registrationInfo;
    const credentialId = info.credential.id;

    // A credential belongs to exactly one profile. Re-registering the same
    // authenticator for the same profile is a refresh, not a second account.
    const owner = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      select: { id: true, profileId: true },
    });
    if (owner && owner.profileId !== profileId) {
      throw new AuthFailure(401, "passkey_failed");
    }

    const transports = parseTransports(
      JSON.stringify(info.credential.transports ?? response.response.transports ?? []),
    );
    const storedLabel =
      label?.trim().slice(0, 80) || defaultCredentialLabel(userAgent);
    const data = {
      profileId,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      transports: JSON.stringify(transports),
      backedUp: info.credentialBackedUp,
      label: storedLabel,
    };

    const credential = owner
      ? await this.prisma.webAuthnCredential.update({
          where: { id: owner.id },
          data,
        })
      : await this.prisma.webAuthnCredential.create({
          data: {
            id: randomUUID(),
            credentialId,
            ...data,
          },
        });

    return publicCredential(credential);
  }

  async loginOptions(profileId: number | null) {
    const config = this.assertConfigured();

    let allowCredentials: { id: string; transports?: string[] }[] | undefined;
    if (profileId !== null) {
      const credentials = await this.prisma.webAuthnCredential.findMany({
        where: { profileId },
        select: { credentialId: true, transports: true },
      });
      allowCredentials = credentials.map((credential) => ({
        id: credential.credentialId,
        transports: parseTransports(credential.transports),
      }));
      if (allowCredentials.length === 0) {
        throw new AuthFailure(404, "passkey_not_found");
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials,
      userVerification: "required",
    });
    await this.storeChallenge(options.challenge, "authentication", profileId);
    return options;
  }

  async verifyLogin(
    response: AuthenticationResponseJSON,
    meta: SessionMetadata,
    auth: AuthService,
  ) {
    const config = this.assertConfigured();
    const challenge = this.challengeOf(response.response.clientDataJSON);
    const challengeRow = await this.claimChallenge(challenge, "authentication");

    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!stored) throw new AuthFailure(401, "passkey_failed");

    // A ceremony started for one profile cannot be completed with another
    // profile's credential.
    if (challengeRow.profileId !== null && challengeRow.profileId !== stored.profileId) {
      throw new AuthFailure(401, "passkey_failed");
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        credential: storedCredentialToVerificationInput(stored),
        requireUserVerification: true,
      });
    } catch {
      throw new AuthFailure(401, "passkey_failed");
    }

    if (!verification.verified) throw new AuthFailure(401, "passkey_failed");
    if (isCounterRegression(stored.counter, verification.authenticationInfo.newCounter)) {
      throw new AuthFailure(401, "passkey_failed");
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: this.now(),
        backedUp: verification.authenticationInfo.credentialBackedUp,
      },
    });

    return auth.createProfileSession(stored.profileId, "profile", meta);
  }

  async list(profileId: number) {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { profileId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(publicCredential);
  }

  async remove(profileId: number, credentialId: string): Promise<void> {
    const removed = await this.prisma.webAuthnCredential.deleteMany({
      where: { id: credentialId, profileId },
    });
    if (removed.count === 0) throw new AuthFailure(404, "passkey_not_found");
  }

  private assertConfigured(): PasskeyConfig {
    if (!this.config) throw new AuthFailure(503, "passkey_not_configured");
    return this.config;
  }

  private challengeOf(clientDataJSON: string): string {
    const challenge = challengeFromClientData(clientDataJSON);
    if (!challenge) throw new AuthFailure(401, "passkey_failed");
    return challenge;
  }

  private async storeChallenge(
    challenge: string,
    type: ChallengeType,
    profileId: number | null,
  ): Promise<void> {
    const now = this.now();
    // One live ceremony per challenge value; the value itself is random.
    await this.prisma.webAuthnChallenge.create({
      data: {
        id: randomUUID(),
        profileId,
        challenge,
        type,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      },
    });
  }

  /**
   * Consume the challenge before verification so a replayed response always
   * finds nothing. A failed ceremony therefore needs a fresh options call.
   */
  private async consumeChallenge(
    challenge: string,
    type: ChallengeType,
    profileId: number,
  ): Promise<void> {
    const row = await this.claimChallenge(challenge, type);
    if (row.profileId !== profileId) throw new AuthFailure(401, "passkey_failed");
  }

  private async claimChallenge(challenge: string, type: ChallengeType) {
    const row = await this.prisma.webAuthnChallenge.findUnique({ where: { challenge } });
    if (!row || row.type !== type) throw new AuthFailure(401, "passkey_failed");

    if (row.expiresAt.getTime() <= this.now().getTime()) {
      await this.prisma.webAuthnChallenge.deleteMany({ where: { id: row.id } });
      throw new AuthFailure(401, "passkey_failed");
    }

    const claimed = await this.prisma.webAuthnChallenge.deleteMany({
      where: { id: row.id },
    });
    if (claimed.count === 0) throw new AuthFailure(401, "passkey_failed");
    return row;
  }
}

function parseTransports(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return undefined;
  }
}

function publicCredential(credential: WebAuthnCredential) {
  return {
    id: credential.id,
    label: credential.label,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    backedUp: credential.backedUp,
  };
}

function metadata(request: FastifyRequest): SessionMetadata {
  const userAgent = request.headers["user-agent"];
  const safeUserAgent = typeof userAgent === "string" ? userAgent : null;
  return { userAgent: safeUserAgent, deviceLabel: deviceLabelFromUserAgent(safeUserAgent) };
}

/**
 * Passkey routes. The login pair is public (it is the sign-in); everything else
 * needs the ordinary profile session.
 */
export async function registerPasskeyRoutes(
  app: FastifyInstance,
  passkeys: PasskeyService,
  auth: AuthService,
  options: RegisterAuthOptions,
): Promise<void> {
  app.post<{ Body: { profileId?: number } }>("/api/auth/passkeys/login/options", {
    schema: {
      body: {
        type: "object",
        properties: { profileId: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!passkeys.enabled) return fail(reply, 503, "passkey_not_configured");
    try {
      return await passkeys.loginOptions(request.body?.profileId ?? null);
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Body: { response: AuthenticationResponseJSON } }>(
    "/api/auth/passkeys/login/verify",
    {
      schema: {
        body: {
          type: "object",
          properties: { response: { type: "object" } },
          required: ["response"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (!passkeys.enabled) return fail(reply, 503, "passkey_not_configured");
      try {
        const result = await passkeys.verifyLogin(
          request.body.response,
          metadata(request),
          auth,
        );
        setSessionCookie(reply, result.token, options);
        return loginPayload(result);
      } catch (error) {
        return sendAuthFailure(reply, error);
      }
    },
  );

  app.post("/api/auth/passkeys/register/options", async (request, reply) => {
    if (!passkeys.enabled) return fail(reply, 503, "passkey_not_configured");
    const context = request.auth;
    if (!context?.profile) return fail(reply, 403, "forbidden");
    try {
      return await passkeys.registrationOptions(context.profile.id);
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Body: { response: RegistrationResponseJSON; label?: string } }>(
    "/api/auth/passkeys/register/verify",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            response: { type: "object" },
            label: { type: "string", maxLength: 80 },
          },
          required: ["response"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (!passkeys.enabled) return fail(reply, 503, "passkey_not_configured");
      const context = request.auth;
      if (!context?.profile) return fail(reply, 403, "forbidden");
      const userAgent = request.headers["user-agent"];
      try {
        const credential = await passkeys.verifyRegistration(
          context.profile.id,
          request.body.response,
          request.body.label,
          typeof userAgent === "string" ? userAgent : null,
        );
        return { ok: true, credential };
      } catch (error) {
        return sendAuthFailure(reply, error);
      }
    },
  );

  app.get("/api/auth/passkeys", async (request, reply) => {
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    if (!passkeys.enabled) return { passkeys: [], configured: false };
    return {
      configured: true,
      passkeys: await passkeys.list(request.auth.profile.id),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/auth/passkeys/:id", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    if (!passkeys.enabled) return fail(reply, 503, "passkey_not_configured");
    try {
      await passkeys.remove(request.auth.profile.id, request.params.id);
      return { ok: true };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });
}
