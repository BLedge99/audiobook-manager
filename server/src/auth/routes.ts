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

export interface RegisterAuthOptions {
  /** `Secure` cookies are required once the web is served over HTTPS. */
  secureCookie: boolean;
}

function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    role: profile.role === "admin" ? "admin" : "member",
  };
}

export function loginPayload(result: LoginResult) {
  return {
    ok: true,
    token: result.token,
    role: result.role,
    profile: result.profile ? publicProfile(result.profile) : null,
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
export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  options: RegisterAuthOptions,
): Promise<void> {
  // The device secret is presented only after the OS biometric prompt has
  // released it from the native Vault. It is exchanged for an ordinary,
  // revocable profile session and is never returned again.
  app.post<{ Body: { secret: string } }>("/api/auth/devices/session", {
    schema: { body: { type: "object", properties: { secret: { type: "string", minLength: 20, maxLength: 128 } }, required: ["secret"], additionalProperties: false } },
  }, async (request, reply) => {
    try {
      const result = await auth.exchangeDeviceCredential(request.body.secret, metadata(request));
      setSessionCookie(reply, result.token, options);
      return loginPayload(result);
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Body: { label?: string } }>("/api/auth/devices", {
    schema: { body: { type: "object", properties: { label: { type: "string", maxLength: 80 } }, additionalProperties: false } },
  }, async (request, reply) => {
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    try {
      return await auth.createDeviceCredential(request.auth.profile.id, request.body.label ?? null);
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.get("/api/auth/devices", async (request, reply) => {
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    return { devices: await auth.listDeviceCredentials(request.auth.profile.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/auth/devices/:id", {
    schema: { params: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 80 } }, required: ["id"] } },
  }, async (request, reply) => {
    if (!request.auth?.profile) return fail(reply, 403, "forbidden");
    try {
      await auth.revokeDeviceCredential(request.auth.profile.id, request.params.id);
      return { ok: true };
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.post<{ Body: { password: string; profileId?: number } }>("/api/auth/login", {
    schema: {
      body: {
        type: "object",
        properties: {
          password: { type: "string" },
          profileId: { type: "integer", minimum: 1 },
        },
        required: ["password"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!auth.enabled) return { token: "disabled", authDisabled: true };

    try {
      const result = request.body.profileId
        ? await auth.loginProfile(
            request.body.profileId,
            request.body.password,
            metadata(request),
            request.ip,
          )
        : await auth.loginHousehold(request.body.password, metadata(request), request.ip);
      setSessionCookie(reply, result.token, options);
      return loginPayload(result);
    } catch (error) {
      return sendAuthFailure(reply, error);
    }
  });

  app.get("/api/auth/accounts", async () => auth.listAccounts());

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
      profile: context.profile ? publicProfile(context.profile) : null,
      role: context.role,
      via: context.via,
      expiresAt: context.session.expiresAt,
      capabilities: {
        passkeys: Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN),
        devices: true,
      },
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
      try {
        const result = await auth.claim(
          request.body.profileId,
          request.body.householdPassword,
          request.body.newPassword,
          metadata(request),
          request.ip,
        );
        setSessionCookie(reply, result.token, options);
        return loginPayload(result);
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
}
