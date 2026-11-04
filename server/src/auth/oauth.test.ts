import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  OAUTH_STATE_COOKIE,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  oauthConfigFromEnv,
  oauthProviderById,
  safeEqualStrings,
  type OAuthProvider,
} from "./oauth";

const GOOGLE: OAuthProvider = {
  id: "google",
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: "openid profile email",
  issuer: "https://accounts.google.com",
};

describe("oauthConfigFromEnv", () => {
  it("is disabled with no provider credentials", () => {
    const config = oauthConfigFromEnv({ OAUTH_ENABLED: "", GOOGLE_CLIENT_ID: "", GITHUB_CLIENT_ID: "" } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.providers).toEqual([]);
  });

  it("is enabled with a configured Google provider", () => {
    const config = oauthConfigFromEnv({
      OAUTH_ENABLED: "true",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
    } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(true);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]?.id).toBe("google");
    expect(oauthProviderById(config, "google")?.clientId).toBe("id");
    expect(oauthProviderById(config, "github")).toBeNull();
  });

  it("supports both configured providers", () => {
    const config = oauthConfigFromEnv({
      OAUTH_ENABLED: "true",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    } as NodeJS.ProcessEnv);
    expect(config.providers.map((provider) => provider.id)).toEqual(["google", "github"]);
  });
});

describe("createPkcePair", () => {
  it("creates a verifier and its S256 challenge", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    expect(codeVerifier).toBeTruthy();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeChallenge).toBe(createHash("sha256").update(codeVerifier).digest("base64url"));
  });

  it("creates a fresh pair per call", () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a Google authorization URL with PKCE and state", () => {
    const url = buildAuthorizeUrl(GOOGLE, { redirectUri: "https://books.home.arpa/api/auth/google/callback", state: "state-1", codeChallenge: "challenge" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(GOOGLE.authorizationUrl);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("google-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://books.home.arpa/api/auth/google/callback");
    expect(parsed.searchParams.get("scope")).toBe("openid profile email");
    expect(parsed.searchParams.get("state")).toBe("state-1");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeAuthorizationCode", () => {
  it("requests a JSON token response from GitHub", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return new Response(JSON.stringify({ access_token: "access-token", token_type: "bearer" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeAuthorizationCode({
      id: "github",
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
      scope: "read:user user:email",
    }, {
      code: "authorization-code",
      redirectUri: "https://example.com/api/auth/github/callback",
      codeVerifier: "verifier",
    });

    expect(token.accessToken).toBe("access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("safeEqualStrings", () => {
  it("compares equal strings and rejects different ones", () => {
    expect(safeEqualStrings("abc", "abc")).toBe(true);
    expect(safeEqualStrings("abc", "abd")).toBe(false);
    expect(safeEqualStrings("", "")).toBe(true);
  });
});

describe("OAUTH_STATE_COOKIE", () => {
  it("is the cookie the authorize leg writes the state into", () => {
    expect(OAUTH_STATE_COOKIE).toBe("oauth_state");
  });
});
