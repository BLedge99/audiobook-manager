import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hashPassword, verifyPassword } from "../auth/password";
import { hashSessionToken } from "../auth/session";
import { fail } from "../http-errors";

export const ADMIN_SESSION_COOKIE = "admin_panel_session";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LIMIT_WINDOW_MS = 5 * 60 * 1000;
const LIMIT_ATTEMPTS = 10;

export class AdminAuth {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly prisma: PrismaClient, private readonly now = () => new Date()) {}

  async seed(password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.prisma.adminCredential.upsert({
      where: { id: 1 }, create: { id: 1, passwordHash }, update: { passwordHash },
    });
  }

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.prisma.adminCredential.findUnique({ where: { id: 1 }, select: { id: true } }));
  }

  async login(password: string, ip: string): Promise<string | null> {
    if (!(await this.prisma.adminCredential.findUnique({ where: { id: 1 }, select: { id: true } }))) return null;
    const now = this.now().getTime();
    const rate = this.attempts.get(ip);
    if (rate && rate.resetAt > now && rate.count >= LIMIT_ATTEMPTS) return null;
    const credential = await this.prisma.adminCredential.findUnique({ where: { id: 1 } });
    const valid = await verifyPassword(password, credential?.passwordHash);
    if (!valid) {
      const current = rate && rate.resetAt > now ? rate : { count: 0, resetAt: now + LIMIT_WINDOW_MS };
      current.count++;
      this.attempts.set(ip, current);
      return null;
    }
    this.attempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    await this.prisma.adminSession.create({
      data: { id: randomBytes(12).toString("hex"), tokenHash: hashSessionToken(token), expiresAt: new Date(now + ADMIN_SESSION_TTL_MS) },
    });
    return token;
  }

  async validate(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    return Boolean(session && !session.revokedAt && session.expiresAt > this.now());
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.adminSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null }, data: { revokedAt: this.now() },
    });
  }
}

function tokenFrom(request: FastifyRequest): string | undefined {
  const value = request.cookies?.[ADMIN_SESSION_COOKIE];
  return typeof value === "string" ? value : undefined;
}

export async function registerAdminAuth(app: FastifyInstance, auth: AdminAuth, secureCookie: boolean): Promise<void> {
  app.post<{ Body: { password: string } }>("/api/admin/login", {
    schema: { body: { type: "object", properties: { password: { type: "string", maxLength: 128 } }, required: ["password"], additionalProperties: false } },
  }, async (request, reply) => {
    if (!(await auth.isConfigured())) return fail(reply, 503, "admin_not_configured");
    const token = await auth.login(request.body.password, request.ip);
    if (!token) return fail(reply, 401, "auth_required");
    reply.setCookie(ADMIN_SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict", secure: secureCookie, maxAge: ADMIN_SESSION_TTL_MS / 1000 });
    return { ok: true };
  });
  app.get("/api/admin/session", { preHandler: requireAdminSession(auth) }, async () => {
    return { authenticated: true };
  });
  app.post("/api/admin/logout", async (request, reply) => {
    await auth.logout(tokenFrom(request));
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}

export function requireAdminSession(auth: AdminAuth) {
  return async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!await auth.validate(tokenFrom(request))) return fail(reply, 401, "admin_auth_required");
  };
}
