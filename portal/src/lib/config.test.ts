import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const SECRET = "s".repeat(48);
const VALID_ENV = {
  DATABASE_URL: "mysql://portal:secret-db-password@127.0.0.1:3306/portal",
  SESSION_SECRET: SECRET,
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAZUH_INDEXER_URL: "https://192.0.2.20:9200",
  WAZUH_DASHBOARD_URL: "https://192.0.2.20",
  WAZUH_INDEXER_USERNAME: "svc-portal",
  WAZUH_INDEXER_PASSWORD: "secret-wazuh-password",
  TRUSTED_NETWORKS: "192.0.2.0/24, 198.51.100.0/24",
  PORTAL_BASE_URL: "https://portal.hospital.example",
};

function expectConfigError(env: Record<string, string | undefined>, variable: string) {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variables).toContain(variable);
    return error as ConfigError;
  }
  throw new Error(`expected ConfigError for ${variable}`);
}

describe("loadConfig", () => {
  it("parses a complete configuration", () => {
    const config = loadConfig(VALID_ENV);
    expect(config.wazuh.indexerUrl).toBe("https://192.0.2.20:9200");
    expect(config.wazuh.pollIntervalSeconds).toBe(60);
    expect(config.trustedNetworks).toEqual(["192.0.2.0/24", "198.51.100.0/24"]);
    expect(config.totpEncryptionKey).toHaveLength(32);
    expect(config.timeZone).toBe("Asia/Bangkok");
  });

  it.each([
    "DATABASE_URL",
    "SESSION_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "WAZUH_INDEXER_URL",
    "WAZUH_DASHBOARD_URL",
    "WAZUH_INDEXER_USERNAME",
    "WAZUH_INDEXER_PASSWORD",
    "TRUSTED_NETWORKS",
    "PORTAL_BASE_URL",
  ])("fails when %s is missing", (variable) => {
    expectConfigError({ ...VALID_ENV, [variable]: undefined }, variable);
  });

  it("reports every problem at once", () => {
    const error = expectConfigError({}, "DATABASE_URL");
    expect(error.variables.length).toBeGreaterThanOrEqual(8);
  });

  it("never echoes secret values in the error message", () => {
    const error = expectConfigError(
      { ...VALID_ENV, SESSION_SECRET: "short-secret-value", WAZUH_INDEXER_URL: "http://secret-wazuh-password@x" },
      "SESSION_SECRET",
    );
    expect(error.message).not.toContain("short-secret-value");
    expect(error.message).not.toContain("secret-wazuh-password");
    expect(error.message).not.toContain("secret-db-password");
  });

  it("requires a long session secret", () => {
    expectConfigError({ ...VALID_ENV, SESSION_SECRET: "too-short" }, "SESSION_SECRET");
  });

  it("requires a 32-byte TOTP encryption key", () => {
    expectConfigError({ ...VALID_ENV, TOTP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }, "TOTP_ENCRYPTION_KEY");
  });

  it("requires HTTPS for the Wazuh Indexer and the Portal", () => {
    expectConfigError({ ...VALID_ENV, WAZUH_INDEXER_URL: "http://192.0.2.20:9200" }, "WAZUH_INDEXER_URL");
    expectConfigError({ ...VALID_ENV, PORTAL_BASE_URL: "http://portal" }, "PORTAL_BASE_URL");
  });

  it("rejects trusted networks that open the Portal to everyone", () => {
    expectConfigError({ ...VALID_ENV, TRUSTED_NETWORKS: "0.0.0.0/0" }, "TRUSTED_NETWORKS");
    expectConfigError({ ...VALID_ENV, TRUSTED_NETWORKS: "not-a-network" }, "TRUSTED_NETWORKS");
  });

  it("caps the Wazuh poll interval so P1 targets hold", () => {
    expect(loadConfig({ ...VALID_ENV, WAZUH_POLL_INTERVAL_SECONDS: "30" }).wazuh.pollIntervalSeconds).toBe(30);
    expectConfigError({ ...VALID_ENV, WAZUH_POLL_INTERVAL_SECONDS: "300" }, "WAZUH_POLL_INTERVAL_SECONDS");
  });
});
