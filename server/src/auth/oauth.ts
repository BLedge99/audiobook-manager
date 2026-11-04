import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * External sign-in support for the production demo audience (spec 32, ADR 023).
 *
 * The production deployment lets people sign in over the web with Google or
 * GitHub, or with email + password. The OAuth half is the Authorization Code
 * flow with PKCE, token exchange and identity validation — all on the server,
 * none of it in the browser.
 */

/** The cookie the authorize step writes the opaque OAuth state into. */
export const OAUTH_STATE_COOKIE = "oauth_state";

export type OAuthProviderId = "google" | "github";

export interface OAuthProvider {
  id: OAuthProviderId;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  /** OIDC-style scope for Google (`openid profile email`); GitHub uses `read:user`. */
  scope: string;
  /** OIDC issuer for Google; the identity source is the signed userinfo endpoint. */
  issuer?: string;
}

export interface OAuthConfig {
  enabled: boolean;
  providers: OAuthProvider[];
}

export function oauthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OAuthConfig {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const githubClientId = env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const providers: OAuthProvider[] = [];

  if (googleClientId && googleClientSecret) {
    providers.push({
      id: "google",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid profile email",
      issuer: "https://accounts.google.com",
    });
  }

  if (githubClientId && githubClientSecret) {
    providers.push({
      id: "github",
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
      scope: "read:user",
    });
  }

  return { enabled: env.OAUTH_ENABLED === "true", providers };
}

export function oauthProviderById(
  config: OAuthConfig,
  id: string,
): OAuthProvider | null {
  return config.providers.find((provider) => provider.id === id) ?? null;
}

/** PKCE (RFC 7636) with S256 — the method the current OAuth best practice
 *  requires for every client, public or confidential, using the code flow. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  input: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: input.redirectUri,
    scope: provider.scope,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  const url = new URL(provider.authorizationUrl);
  for (const [key, value] of params.entries()) url.searchParams.set(key, value);
  return url.toString();
}

export interface OAuthToken {
  accessToken: string;
  idToken?: string;
  tokenType: string;
  scope: string;
}

/**
 * Exchange the authorization code for tokens. Confidential-client style: the
 * client secret and the PKCE verifier both go to the token endpoint over TLS.
 */
export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  input: { code: string; redirectUri: string; codeVerifier: string },
): Promise<OAuthToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("oauth_code_exchange_failed");
  const json = (await response.json()) as {
    access_token?: string;
    id_token?: string;
    token_type?: string;
    scope?: string;
  };
  if (!json.access_token) throw new Error("oauth_code_exchange_failed");
  return {
    accessToken: json.access_token,
    idToken: json.id_token,
    tokenType: json.token_type ?? "Bearer",
    scope: json.scope ?? provider.scope,
  };
}

export interface OAuthIdentity {
  sub: string;
  email: string | null;
  /** Google: the IdP-reported verification flag. GitHub: email presence. */
  emailVerified: boolean;
  name: string | null;
}

export async function fetchOAuthIdentity(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthIdentity> {
  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("oauth_code_exchange_failed");
  const json = (await response.json()) as Record<string, unknown>;

  if (provider.id === "google") {
    const sub = typeof json.sub === "string" ? json.sub : "";
    const email = typeof json.email === "string" ? json.email : null;
    const name = typeof json.name === "string" ? json.name : null;
    return {
      sub,
      email,
      emailVerified: json.email_verified === true,
      name,
    };
  }

  const login = typeof json.login === "string" ? json.login : "";
  const name = typeof json.name === "string" && json.name ? json.name : login;
  const email = typeof json.email === "string" ? json.email : null;
  return { sub: login, email, emailVerified: email !== null, name };
}

/** Constant-time string comparison, matching the password-verification posture. */
export function safeEqualStrings(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
