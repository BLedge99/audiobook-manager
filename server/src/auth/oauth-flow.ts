import { randomUUID } from "node:crypto";
import type { PrismaClient, Profile } from "@prisma/client";
import { AuthFailure } from "./service-types";
import type { OAuthConfig, OAuthIdentity, OAuthProvider } from "./oauth";
import { exchangeAuthorizationCode, fetchOAuthIdentity, safeEqualStrings } from "./oauth";
import type { LoginResult, SessionMetadata } from "./service-types";
import type { SlidingRateLimiter } from "./lockout";

export interface OAuthFlowOptions {
  prisma: PrismaClient;
  oauth: OAuthConfig;
  rateLimiter: SlidingRateLimiter;
  now?: () => Date;
  createSession: (profileId: number | null, via: "oauth", meta: SessionMetadata) => Promise<LoginResult>;
}

export class OAuthFlow {
  private readonly prisma: PrismaClient;
  private readonly oauth: OAuthConfig;
  private readonly rateLimiter: SlidingRateLimiter;
  private readonly now: () => Date;
  private readonly createSession: (profileId: number | null, via: "oauth", meta: SessionMetadata) => Promise<LoginResult>;

  constructor(options: OAuthFlowOptions) {
    this.prisma = options.prisma;
    this.oauth = options.oauth;
    this.rateLimiter = options.rateLimiter;
    this.now = options.now ?? (() => new Date());
    this.createSession = options.createSession;
  }

  async signInWithOAuth(input: {
    provider: OAuthProvider;
    code: string;
    state: string;
    stateCookieValue: string | null;
    codeVerifier: string;
    redirectUri: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    if (!this.oauth.enabled || !input.provider) throw new AuthFailure(503, "oauth_not_configured");
    this.rateLimiter.check(input.ip);
    try {
      if (!input.stateCookieValue || !safeEqualStrings(input.state, input.stateCookieValue)) {
        throw new AuthFailure(400, "oauth_state_mismatch");
      }

      const token = await exchangeAuthorizationCode(input.provider, {
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
      });

      let identity: OAuthIdentity;
      try {
        identity = await fetchOAuthIdentity(input.provider, token.accessToken);
      } catch (error) {
        if (error instanceof Error && error.message === "oauth_identity_unavailable") {
          throw new AuthFailure(502, "oauth_identity_unavailable");
        }
        throw error;
      }
      if (!identity.sub || identity.sub.length > 255) throw new AuthFailure(401, "oauth_identity_invalid");
      if (input.provider.id === "google" && (!identity.email || !identity.emailVerified)) {
        throw new AuthFailure(403, "oauth_email_not_verified");
      }
      if (input.provider.id === "github" && identity.email && !identity.emailVerified) {
        throw new AuthFailure(403, "oauth_email_not_verified");
      }

      const profile = await this.resolveOAuthProfile(input.provider, identity);
      if (profile.disabled) throw new AuthFailure(403, "account_disabled");
      this.rateLimiter.clear(input.ip);
      return this.createSession(profile.id, "oauth", input.meta);
    } catch (error) {
      this.rateLimiter.record(input.ip);
      throw error;
    }
  }

  private async resolveOAuthProfile(provider: OAuthProvider, identity: OAuthIdentity): Promise<Profile> {
    const byProvider = await this.prisma.profile.findFirst({
      where: { oauthProvider: provider.id, oauthProviderId: identity.sub },
    });
    if (byProvider) {
      if (byProvider.disabled) throw new AuthFailure(403, "account_disabled");
      return byProvider;
    }

    const byEmail = identity.email && identity.emailVerified
      ? await this.prisma.profile.findFirst({ where: { email: identity.email.toLowerCase() } })
      : null;
    if (byEmail) {
      if (byEmail.disabled) throw new AuthFailure(403, "account_disabled");
      throw new AuthFailure(409, "account_linking_required");
    }

    const baseName = (identity.name ?? "").trim() || identity.email?.split("@")[0] || `Listener ${provider.id}`;
    let name = baseName;
    for (let attempt = 2; ; attempt += 1) {
      const clash = await this.prisma.profile.findUnique({ where: { name } });
      if (!clash) break;
      name = `${baseName} ${attempt}`;
    }

    const profile = await this.prisma.profile.create({
      data: {
        name,
        role: "member",
        followsServerLibrary: true,
        email: identity.email,
        oauthProvider: provider.id,
        oauthProviderId: identity.sub,
        lastActiveAt: this.now(),
      },
    });
    return profile;
  }
}
