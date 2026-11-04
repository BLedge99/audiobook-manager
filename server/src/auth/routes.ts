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
    sameSite: "lax",
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

  app.post<{ Body: { label?: string } }>("/api/auth/devices", {
    schema: { body: { type: "object", properties: { label: { type: "string", maxLength: 80 } }, additionalProperties: false } },
  }, async (request, reply) => {
    if (demoMode()) return fail(reply, 404, "not_found");
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    try {
      return await auth.createDeviceCredential(request.auth.profile.id, request.body.label ?? null);
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
    if (demoMode() && !request.body.email) return fail(reply, 404, "not_found");

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

  app.get("/api/auth/sessions", async (request, reply) => {
    if (!request.auth) return fail(reply, 401, "auth_required");
    return { sessions: await auth.listSessions(request.auth) };
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
    app.log.info({ oauth_enabled: auth.oauth.enabled, provider_param: request.params.provider, oauth_providers: auth.oauth.providers.map(p => p.id) }, "authorize endpoint called");
    const provider = auth.oauth.enabled ? oauthProviderById(auth.oauth, request.params.provider) : null;
    if (!provider) {
      app.log.warn({ provider_param: request.params.provider, oauth_enabled: auth.oauth.enabled }, "provider not found");
      return fail(reply, 404, "not_found");
    }
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = randomBytes(16).toString("hex");
    const redirectUri = provider.redirectUri ?? `${request.protocol}://${request.hostname}/api/auth/${provider.id}/callback`;
    reply
      .setCookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: options.secureCookie, path: "/api/auth", maxAge: 600 })
      .setCookie("oauth_code_verifier", codeVerifier, { httpOnly: true, sameSite: "lax", secure: options.secureCookie, path: "/api/auth", maxAge: 600 })
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
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth" });
      reply.clearCookie("oauth_code_verifier", { path: "/api/auth" });
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
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth" });
      reply.clearCookie("oauth_code_verifier", { path: "/api/auth" });
      setSessionCookie(reply, result.token, options);
      await cleanupAfterLogin(auth);
      return reply.redirect("/");
    } catch (error) {
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth" });
      reply.clearCookie("oauth_code_verifier", { path: "/api/auth" });
      if (error instanceof AuthFailure) {
        return reply.redirect(`/?auth_error=${error.code}`);
      }
      throw error;
    }
  });
}
