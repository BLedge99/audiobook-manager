import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Profile } from "@prisma/client";
import { fail } from "../http-errors";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  deviceLabelFromUserAgent,
  sessionTokenFromRequest,
} from "./session";
import { AuthFailure, AuthService, type LoginResult } from "./service";
import {
  OAUTH_STATE_COOKIE,
  buildAuthorizeUrl,
  createPkcePair,
  oauthProviderById,
} from "./oauth";
import type { OAuthProvider } from "./oauth";

export interface RegisterAuthOptions {
  /** `Secure` cookies are required once the web is served over HTTPS. */
  secureCookie: boolean;
  accountExperience?: "household" | "demo";
  accountExperienceResolver?: () => "household" | "demo";
  emailSignUpAllowed?: boolean;
}

function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    role: profile.role === "admin" ? "admin" : "member",
  };
}

export function loginPayload(result: LoginResult, demoMode = false) {
  return {
    ok: true,
    token: result.token,
    role: demoMode ? "member" : result.role,
    profile: result.profile ? (demoMode ? { email: result.profile.email } : publicProfile(result.profile)) : null,
    expiresAt: result.session.expiresAt,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: RegisterAuthOptions,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: options.secureCookie ? "none" : "lax",
    secure: options.secureCookie,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  const safeUserAgent = typeof userAgent === "string" ? userAgent : null;
  return { userAgent: safeUserAgent, deviceLabel: deviceLabelFromUserAgent(safeUserAgent) };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

export function sendAuthFailure(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AuthFailure)) throw error;
  if (error.code === "account_locked" && error.params?.retryAfterSeconds) {
    reply.header("retry-after", String(error.params.retryAfterSeconds));
  }
  return fail(reply, error.status, error.code, error.params);
}

/**
 * The account surface (spec 28). It is registered as a module rather than
 * inline in `app.ts` because the auth gate and these routes share the service
 * and must move together.
 */
/**
 * Spec 28: expired and revoked session rows are deleted by a best-effort
 * cleanup on login. Correctness never depends on it -- `validate` already
 * rejects those rows -- so a failure is swallowed rather than turning a
 * successful sign-in into an error.
 *
 * This lives on the login path (not a timer) because a login is the moment the
 * server is already writing to the table, and it is bounded by how often a
 * person signs in.
 */
async function cleanupAfterLogin(auth: AuthService): Promise<void> {
  try {
    await auth.cleanupExpired();
  } catch {
    /* best effort */
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  options: RegisterAuthOptions,
): Promise<void> {
  const demoMode = () => (options.accountExperienceResolver?.() ?? options.accountExperience) === "demo";
  // The device secret is presented only after the OS biometric prompt has
  // released it from the native Vault. It is exchanged for an ordinary,
  // revocable profile session and is never returned again.
  app.post<{ Body: { secret: string } }>("/api/auth/devices/session", {
    schema: { body: { type: "object", properties: { secret: { type: "string", minLength: 20, maxLength: 128 } }, required: ["secret"], additionalProperties: false } },
  }, async (request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    try {
      const result = await auth.exchangeDeviceCredential(request.body.secret, metadata(request));
      setSessionCookie(reply, result.token, options);
      await cleanupAfterLogin(auth);
      return loginPayload(result, demoMode());
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  /**
   * Enrol a device.
   *
   * `deviceId` is the client's own installation identifier (spec 36). It names
   * the device in the "Signed-in devices" panel and authorises nothing; the
   * session it mints is anchored to the credential this route returns.
   */
  app.post<{ Body: { label?: string; deviceId?: string } }>("/api/auth/devices", {
    schema: {
      body: {
        type: "object",
        properties: {
          label: { type: "string", maxLength: 80 },
          deviceId: { type: "string", maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    try {
      return await auth.createDeviceCredential(
        request.auth.profile.id,
        request.body.label ?? null,
        request.body.deviceId ?? null,
      );
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.get("/api/auth/devices", async (request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    return { devices: await auth.listDeviceCredentials(request.auth.profile.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/auth/devices/:id", {
    schema: { params: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 80 } }, required: ["id"] } },
  }, async (request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    try {
      await auth.revokeDeviceCredential(request.auth.profile.id, request.params.id);
      return { ok: true };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Body: { password: string; profileId?: number; email?: string } }>("/api/auth/login", {
    schema: {
      body: {
        type: "object",
        properties: {
          password: { type: "string" },
          profileId: { type: "integer", minimum: 1 },
          email: { type: "string" },
        },
        required: ["password"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!auth.enabled && demoMode()) return fail(reply, 503, "auth_required");
    if (!auth.enabled) return { token: "disabled", authDisabled: true };
    if (demoMode() && request.body.profileId) {
      // Demo mode is the account surface (spec 33): a profile-scoped password
      // sign-in is not offered there. The *household* password is deployment
      // configuration rather than an account surface, so it stays available on
      // any server that has `APP_PASSWORD` set - including the production demo,
      // which configures one. Without this the household break-glass key the
      // operator installed on the demo host answered 404, and the listener who
      // reached for it got a generic "the server did not answer as expected" for
      // what was really a deliberate refusal.
      return fail(reply, 404, "not_found");
    }

    try {
      const result = request.body.email
        ? await auth.signInWithEmail({
            email: request.body.email,
            password: request.body.password,
            meta: metadata(request),
            ip: request.ip,
          })
        : request.body.profileId
          ? await auth.loginProfile(
              request.body.profileId,
              request.body.password,
              metadata(request),
              request.ip,
            )
          : await auth.loginHousehold(request.body.password, metadata(request), request.ip);
      setSessionCookie(reply, result.token, options);
      await cleanupAfterLogin(auth);
      return loginPayload(result, demoMode());
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.get("/api/auth/accounts", async (_request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    return auth.listAccounts();
  });

  app.post<{ Body: { name: string; householdPassword: string; password: string } }>(
    "/api/auth/register-profile",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            householdPassword: { type: "string", minLength: 1, maxLength: 256 },
            password: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["name", "householdPassword", "password"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (demoMode()) return fail(reply, 404, "not_found");
      try {
        const result = await auth.registerProfile(
          request.body.name,
          request.body.householdPassword,
          request.body.password,
          metadata(request),
          request.ip,
        );
        setSessionCookie(reply, result.token, options);
        await cleanupAfterLogin(auth);
        return loginPayload(result);
      } catch (error) {
        return sendAuthFailure(reply, error);
      }
    },
  );

  app.post<{ Body: { email: string; password: string } }>("/api/auth/signup", {
    schema: {
      body: {
        type: "object",
        properties: {
          email: { type: "string", minLength: 3, maxLength: 254 },
          password: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["email", "password"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!options.emailSignUpAllowed) return fail(reply, 404, "not_found");
    if (!auth.enabled) return fail(reply, 503, "auth_required");
    try {
      const result = await auth.signUpWithEmail({
        email: request.body.email,
        password: request.body.password,
        meta: metadata(request),
        ip: request.ip,
      });
      setSessionCookie(reply, result.token, options);
      await cleanupAfterLogin(auth);
      return loginPayload(result, demoMode());
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.get("/api/auth/session", async (request, reply) => {
    if (!auth.enabled) {
      return {
        authDisabled: true,
        profile: null,
        role: "admin",
        via: "household",
        expiresAt: null,
        capabilities: {
          passkeys: false,
          devices: false,
        },
      };
    }

    const context = request.auth;
    if (!context) return fail(reply, 401, "auth_required");
    return {
      authDisabled: false,
      profile: context.profile
        ? demoMode()
          ? { email: context.profile.email }
          : publicProfile(context.profile)
        : null,
      role: demoMode() ? "member" : context.role,
      via: context.via,
      expiresAt: context.session.expiresAt,
      capabilities: {
        passkeys: Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN),
        devices: true,
      },
    };
  });

  /**
   * The public capability list the sign-in surface needs.
   *
   * The client must not offer a provider that the server cannot complete: an
   * "Sign in with Google" button that answers 404 is a dead end, and the
   * person cannot tell that from a misconfigured app. The provider list is
   * therefore part of the public config, and it is derived from the same
   * `OAuthConfig` the callback uses -- so it can never disagree with it.
   */
  app.get("/api/auth/providers", async (_request, reply) => {
    return {
      providers: auth.oauth.enabled
        ? auth.oauth.providers.map((provider) => ({ id: provider.id }))
        : [],
      emailSignUpAllowed: options.emailSignUpAllowed === true,
      emailSignInAllowed: true,
    };
  });

  // Public on purpose: a client must be able to clear a stale cookie/token even
  // when the session has already expired.
  app.post("/api/auth/logout", async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    if (token) await auth.revokeToken(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post<{ Body: { profileId: number; householdPassword: string; newPassword: string } }>(
    "/api/auth/claim",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            profileId: { type: "integer", minimum: 1 },
            householdPassword: { type: "string" },
            newPassword: { type: "string" },
          },
          required: ["profileId", "householdPassword", "newPassword"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (demoMode()) return fail(reply, 404, "not_found");
      try {
        const result = await auth.claim(
          request.body.profileId,
          request.body.householdPassword,
          request.body.newPassword,
          metadata(request),
          request.ip,
        );
        setSessionCookie(reply, result.token, options);
        await cleanupAfterLogin(auth);
        return loginPayload(result, demoMode());
      } catch (error) {
        return sendAuthFailure(reply, error);
      }
    },
  );

  app.post<{ Body: { currentPassword: string; newPassword: string } }>("/api/auth/password", {
    schema: {
      body: {
        type: "object",
        properties: {
          currentPassword: { type: "string" },
          newPassword: { type: "string" },
        },
        required: ["currentPassword", "newPassword"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    try {
      const profile = await auth.changePassword(
        request.auth,
        request.body.currentPassword,
        request.body.newPassword,
      );
      return { ok: true, profile: publicProfile(profile) };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  /**
   * The caller's signed-in devices.
   *
   * Spec 36: this used to return one row per sign-in, so an Android phone that
   * signed in fifty times appeared fifty times. It returns one row per
   * **device** now.
   */
  app.get("/api/auth/sessions", async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    return { devices: await auth.listDevices(request.auth) };
  });

  /**
   * Sign one device out: every session it holds is revoked.
   *
   * The key is a device credential id, or a session id for a browser. Both are
   * resolved against the calling profile.
   */
  app.delete<{ Params: { key: string } }>("/api/auth/sessions/device/:key", {
    schema: {
      params: {
        type: "object",
        properties: { key: { type: "string", minLength: 1, maxLength: 80 } },
        required: ["key"],
      },
    },
  }, async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    try {
      const revoked = await auth.revokeDeviceSessions(request.auth, request.params.key);
      return { ok: true, revoked };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  /** Sign every other device out, leaving the caller's own session alone. */
  app.delete("/api/auth/sessions/others", async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    try {
      const revoked = await auth.revokeOtherSessions(request.auth);
      return { ok: true, revoked };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    try {
      await auth.revokeSession(request.auth, request.params.id);
      return { ok: true };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: { newPassword: string } }>(
    "/api/auth/accounts/:id/reset",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { newPassword: { type: "string" } },
          required: ["newPassword"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (demoMode()) return fail(reply, 404, "not_found");
      const id = parseId(request.params.id);
      if (id === null) return fail(reply, 400, "invalid_id");
      try {
        const profile = await auth.resetPassword(request.auth, id, request.body.newPassword);
        return { ok: true, profile: publicProfile(profile) };
      } catch (error) {
        return sendAuthFailure(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/auth/accounts/:id/unlock", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    try {
      const profile = await auth.unlockProfile(request.auth, id);
      return { ok: true, profile: publicProfile(profile) };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  /**
   * Spec 32 / ADR 023: start the external (Google/GitHub) OAuth flow. The server
   * owns the PKCE pair and the state, redirects the browser to the provider, and
   * keeps both in HttpOnly cookies so the callback can validate without ever
   * touching browser-accessible storage.
   */
  app.get<{ Params: { provider: string } }>("/api/auth/:provider/authorize", async (request, reply) => {
    const provider = auth.oauth.enabled ? oauthProviderById(auth.oauth, request.params.provider) : null;
    if (!provider) return fail(reply, 404, "not_found");
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = randomBytes(16).toString("hex");
    const redirectUri = provider.redirectUri ?? `${request.protocol}://${request.hostname}/api/auth/${provider.id}/callback`;
    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: options.secureCookie, path: "/", maxAge: 600 })
      .setCookie("oauth_code_verifier", codeVerifier, { httpOnly: true, sameSite: "lax", secure: options.secureCookie, path: "/", maxAge: 600 })
      .redirect(buildAuthorizeUrl(provider, { redirectUri, state, codeChallenge }));
  });

  /**
   * Spec 32 / ADR 023: the OAuth provider callback. Validates state, exchanges
   * the code, resolves the identity to a profile and answers with a session.
   * Failures clear the cookies and redirect home with an `auth_error` code for
   * the client to render.
   */
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    "/api/auth/:provider/callback",
    async (request, reply) => {
    const provider = auth.oauth.enabled ? oauthProviderById(auth.oauth, request.params.provider) : null;
    const code = typeof request.query.code === "string" ? request.query.code : null;
    const state = typeof request.query.state === "string" ? request.query.state : null;
    const stateCookieValue = request.cookies?.[OAUTH_STATE_COOKIE] ?? null;
    const codeVerifier = request.cookies?.["oauth_code_verifier"] ?? null;

    if (!provider || !code || !state || !codeVerifier) {
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
      reply.clearCookie("oauth_code_verifier", { path: "/" });
      return reply.redirect("/?auth_error=oauth_state_mismatch");
    }

    const redirectUri = provider.redirectUri ?? `${request.protocol}://${request.hostname}/api/auth/${provider.id}/callback`;
    try {
      const result = await auth.signInWithOAuth({
        provider,
        code,
        state,
        stateCookieValue,
        codeVerifier,
        redirectUri,
        meta: metadata(request),
        ip: request.ip,
      });
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
      reply.clearCookie("oauth_code_verifier", { path: "/" });
      setSessionCookie(reply, result.token, options);
      await cleanupAfterLogin(auth);
      return reply.redirect("/");
    } catch (error) {
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
      reply.clearCookie("oauth_code_verifier", { path: "/" });
      if (error instanceof AuthFailure) {
        return reply.redirect(`/?auth_error=${error.code}`);
      }
      throw error;
    }
  });
}
