import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryAuditStore, createAuditLog } from "../audit";
import {
  createProviderIdLogin,
  ProviderRejectedError,
  ProviderUnavailableError,
  type ProviderIdClient,
  type ProviderProfile,
} from "./provider-id";
import { PROVIDER_ID_ISSUER, type ExternalLoginResult } from "./service";

const HOSPITAL = "10999";
const REDIRECT = "https://portal.example.test/login/provider-id/callback";
const CTX = { ip: "192.0.2.10", correlationId: "c-pid" };

function setup(outcome: ProviderProfile | Error = { providerId: "PID0001", hcodes: [HOSPITAL] }) {
  const exchanged: { code: string; codeVerifier: string; redirectUri: string }[] = [];
  const begun: { issuer: string; subject: string }[] = [];
  const client: ProviderIdClient = {
    authorizationUrl: ({ state, codeChallenge, redirectUri }) =>
      `https://id.example.test/authorize?state=${state}&code_challenge=${codeChallenge}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (input) => {
      exchanged.push(input);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  let result: ExternalLoginResult = { ok: true, challenge: "challenge-token" };
  const auditStore = new InMemoryAuditStore();
  const login = createProviderIdLogin({
    client,
    auth: {
      beginExternalLogin: async (identity) => {
        begun.push(identity);
        return result;
      },
    },
    audit: createAuditLog(auditStore),
    hospitalCode: HOSPITAL,
    redirectUri: REDIRECT,
  });
  return {
    login,
    exchanged,
    begun,
    auditStore,
    setResult: (r: ExternalLoginResult) => {
      result = r;
    },
  };
}

function started(ctx: ReturnType<typeof setup>) {
  const { url, flow } = ctx.login.start();
  const state = new URL(url).searchParams.get("state")!;
  return { url, flow, state };
}

describe("Provider ID login flow", () => {
  it("starts with a random state and an S256 PKCE challenge bound to the flow cookie", () => {
    const ctx = setup();
    const a = started(ctx);
    const b = started(ctx);
    expect(a.state).not.toBe(b.state);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
    const [state, verifier] = a.flow.split(".") as [string, string];
    expect(state).toBe(a.state);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(new URL(a.url).searchParams.get("code_challenge")).toBe(challenge);
    expect(new URL(a.url).searchParams.get("redirect_uri")).toBe(REDIRECT);
  });

  it("exchanges the code with the verifier and opens a challenge for a linked Provider ID", async () => {
    const ctx = setup();
    const { flow, state } = started(ctx);
    const result = await ctx.login.callback({ code: "auth-code", state }, flow, CTX);
    expect(result).toEqual({ ok: true, challenge: "challenge-token" });
    expect(ctx.exchanged).toEqual([{ code: "auth-code", codeVerifier: flow.split(".")[1], redirectUri: REDIRECT }]);
    expect(ctx.begun).toEqual([{ issuer: PROVIDER_ID_ISSUER, subject: "PID0001" }]);
  });

  it("refuses a missing or mismatched state before any code exchange", async () => {
    const ctx = setup();
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state: `${state}x` }, flow, CTX)).toEqual({ ok: false, reason: "bad_request" });
    expect(await ctx.login.callback({ code: "c", state }, undefined, CTX)).toEqual({ ok: false, reason: "bad_request" });
    expect(await ctx.login.callback({ code: null, state }, flow, CTX)).toEqual({ ok: false, reason: "bad_request" });
    expect(await ctx.login.callback({ code: "c", state: null }, flow, CTX)).toEqual({ ok: false, reason: "bad_request" });
    expect(ctx.exchanged).toHaveLength(0);
  });

  it("treats a provider error redirect as a refusal without exchanging", async () => {
    const ctx = setup();
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: null, state, error: "access_denied" }, flow, CTX)).toEqual({
      ok: false,
      reason: "provider_rejected",
    });
    expect(ctx.exchanged).toHaveLength(0);
  });

  it("reports an unreachable provider as unavailable, not as bad credentials", async () => {
    const ctx = setup(new ProviderUnavailableError("timeout"));
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state }, flow, CTX)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(ctx.auditStore.records.at(-1)).toMatchObject({
      action: "auth.login_failed",
      metadata: { reason: "provider_unavailable", method: "provider_id" },
    });
  });

  it("reports a rejected code as a provider refusal", async () => {
    const ctx = setup(new ProviderRejectedError("invalid_grant"));
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state }, flow, CTX)).toEqual({ ok: false, reason: "provider_rejected" });
  });

  it("refuses a Provider ID whose profile does not list the hospital", async () => {
    const ctx = setup({ providerId: "PID0001", hcodes: ["10888"] });
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state }, flow, CTX)).toEqual({ ok: false, reason: "wrong_hospital" });
    expect(ctx.begun).toHaveLength(0);
  });

  it("refuses a malformed Provider ID from the provider", async () => {
    const ctx = setup({ providerId: "", hcodes: [HOSPITAL] });
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state }, flow, CTX)).toEqual({ ok: false, reason: "provider_rejected" });
    expect(ctx.begun).toHaveLength(0);
  });

  it("passes on an unlinked Provider ID", async () => {
    const ctx = setup();
    ctx.setResult({ ok: false, reason: "not_linked" });
    const { flow, state } = started(ctx);
    expect(await ctx.login.callback({ code: "c", state }, flow, CTX)).toEqual({ ok: false, reason: "not_linked" });
  });

  it("never writes the Provider ID profile or code into the audit trail", async () => {
    const ctx = setup({ providerId: "PID0001", hcodes: ["10888"] });
    const { flow, state } = started(ctx);
    await ctx.login.callback({ code: "secret-code", state }, flow, CTX);
    const text = JSON.stringify(ctx.auditStore.records);
    expect(text).not.toContain("secret-code");
    expect(text).not.toContain("PID0001");
  });
});
