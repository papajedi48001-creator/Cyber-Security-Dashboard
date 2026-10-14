import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuditLog } from "../audit";
import { PROVIDER_ID_ISSUER, type AuthService } from "./service";

/**
 * Provider ID Login (ADR 0009). The client hides Health ID and the Provider ID profile API behind
 * two calls and returns only what the Portal needs: the Provider ID and the facility codes.
 */
export interface ProviderProfile {
  providerId: string;
  hcodes: string[];
}

export interface ProviderIdClient {
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** Throws ProviderUnavailableError when the provider cannot be reached, ProviderRejectedError when it refuses. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ProviderProfile>;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRejectedError";
  }
}

export type ProviderIdCallbackResult =
  | { ok: true; challenge: string }
  | {
      ok: false;
      reason: "bad_request" | "provider_unavailable" | "provider_rejected" | "wrong_hospital" | "not_linked" | "invalid_credentials";
    };

export interface ProviderIdLoginDeps {
  client: ProviderIdClient;
  auth: Pick<AuthService, "beginExternalLogin">;
  audit: AuditLog;
  hospitalCode: string;
  redirectUri: string;
}

const PROVIDER_ID = /^[A-Za-z0-9._-]{1,64}$/;
const random = () => randomBytes(32).toString("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createProviderIdLogin({ client, auth, audit, hospitalCode, redirectUri }: ProviderIdLoginDeps) {
  async function refuse(
    reason: Exclude<ProviderIdCallbackResult, { ok: true }>["reason"],
    context: { ip: string; correlationId: string },
  ): Promise<ProviderIdCallbackResult> {
    // The provider's profile and the authorization code are never written to the audit trail.
    await audit.append({
      actor: { id: null, label: "anonymous" },
      action: "auth.login_failed",
      target: { type: "User", id: null },
      metadata: { ip: context.ip, reason, method: "provider_id" },
      correlationId: context.correlationId,
    });
    return { ok: false, reason };
  }

  return {
    /** Returns the provider URL and the value for the short-lived flow cookie (`state.verifier`). */
    start(): { url: string; flow: string } {
      const state = random();
      const verifier = random();
      const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
      return { url: client.authorizationUrl({ state, codeChallenge, redirectUri }), flow: `${state}.${verifier}` };
    },

    async callback(
      query: { code: string | null; state: string | null; error?: string | null },
      flow: string | undefined,
      context: { ip: string; correlationId: string },
    ): Promise<ProviderIdCallbackResult> {
      const [expectedState, verifier] = flow?.split(".") ?? [];
      if (!expectedState || !verifier || !query.state || !sameText(query.state, expectedState))
        return refuse("bad_request", context);
      if (query.error) return refuse("provider_rejected", context);
      if (!query.code) return refuse("bad_request", context);

      let profile: ProviderProfile;
      try {
        profile = await client.exchangeCode({ code: query.code, codeVerifier: verifier, redirectUri });
      } catch (error) {
        return refuse(error instanceof ProviderRejectedError ? "provider_rejected" : "provider_unavailable", context);
      }
      if (!PROVIDER_ID.test(profile.providerId)) return refuse("provider_rejected", context);
      if (!profile.hcodes.includes(hospitalCode)) return refuse("wrong_hospital", context);

      // beginExternalLogin audits its own refusals (not linked, disabled, locked).
      return auth.beginExternalLogin({ issuer: PROVIDER_ID_ISSUER, subject: profile.providerId }, context);
    },
  };
}

export type ProviderIdLogin = ReturnType<typeof createProviderIdLogin>;
