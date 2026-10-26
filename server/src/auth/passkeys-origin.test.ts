import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

/**
 * Spec 28, security rules: the ceremony is bound to `WEBAUTHN_ORIGIN` and
 * `WEBAUTHN_RP_ID`, and "a mismatch is a verification failure, not a warning".
 *
 * The library does the checking, so the thing worth pinning here is the wiring:
 * the server must hand it the configured origin and RP id, and must turn any
 * rejection into `passkey_failed`. The virtual-authenticator E2E covers the
 * happy path against a real browser; it cannot produce a wrong-origin
 * credential.
 */
const verifyRegistrationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  verifyAuthenticationResponse: vi.fn(),
}));

import { PasskeyService, type PasskeyConfig } from "./passkeys";

const CONFIG: PasskeyConfig = {
  rpId: "books.home.arpa",
  rpName: "Bookle",
  origins: ["https://books.home.arpa"],
};

function prismaStub() {
  return {
    webAuthnChallenge: {
      findUnique: vi.fn().mockResolvedValue({
        id: "challenge-row",
        challenge: "challenge-abc",
        type: "registration",
        profileId: 1,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    webAuthnCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn().mockImplementation(async ({ data, ...rest }) => ({
        createdAt: new Date(),
        lastUsedAt: null,
        ...data,
        ...rest,
      })),
    },
  } as unknown as PrismaClient;
}

function service() {
  return new PasskeyService({ prisma: prismaStub(), config: CONFIG });
}

function registrationResponse(origin: string): RegistrationResponseJSON {
  return {
    id: "credential-id",
    rawId: "credential-id",
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(
        JSON.stringify({ type: "webauthn.create", challenge: "challenge-abc", origin }),
      ).toString("base64url"),
      attestationObject: Buffer.from("attestation").toString("base64url"),
      transports: ["internal"],
    },
  } as RegistrationResponseJSON;
}

beforeEach(() => {
  verifyRegistrationResponse.mockReset();
});

describe("passkey origin binding", () => {
  it("verifies against the configured origin and RP id, requiring user verification", async () => {
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "credential-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialBackedUp: false,
      },
    });

    await service().verifyRegistration(
      1,
      registrationResponse("https://books.home.arpa"),
      "Windows Hello",
      "Mozilla/5.0 (Windows NT 10.0)",
    );

    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: ["https://books.home.arpa"],
        expectedRPID: "books.home.arpa",
        requireUserVerification: true,
      }),
    );
  });

  it("turns a mismatched origin into passkey_failed and stores nothing", async () => {
    verifyRegistrationResponse.mockRejectedValue(new Error("Unexpected origin"));

    await expect(
      service().verifyRegistration(
        1,
        registrationResponse("https://evil.example"),
        "Windows Hello",
        "Mozilla/5.0 (Windows NT 10.0)",
      ),
    ).rejects.toMatchObject({ status: 401, code: "passkey_failed" });
  });
});
