import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { ConnectorSettingsError, createConnectorSettings, InMemoryConnectorStore, type ConnectorEnvDefaults } from "./connectors";
import { createSecretBox } from "./secrets";

const admin = { id: "u-admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const operator = { id: "u-op", username: "op", role: "SECURITY_OPERATOR" as const };

const ENV: ConnectorEnvDefaults = {
  "wazuh-indexer": { target: "https://indexer.example.invalid:9200", username: "portal_ro", secret: "synthetic-env-password" },
};

function setup(opts: { key?: boolean; env?: ConnectorEnvDefaults } = {}) {
  const store = new InMemoryConnectorStore();
  const auditStore = new InMemoryAuditStore();
  const service = createConnectorSettings({
    store,
    audit: createAuditLog(auditStore),
    box: opts.key === false ? null : createSecretBox(randomBytes(32)),
    env: opts.env ?? ENV,
    status: async () => ({ lastSuccessAt: null, lastError: null }),
  });
  return { store, auditStore, service };
}

describe("connector settings", () => {
  it("uses the environment once as the bootstrap when no record exists", async () => {
    const { service, store, auditStore } = setup();
    await service.bootstrap();
    expect(store.rows.get("wazuh-indexer")?.target).toBe("https://indexer.example.invalid:9200");
    expect(auditStore.records.at(-1)).toMatchObject({ action: "connector.bootstrapped", targetId: "wazuh-indexer" });
    await service.update(admin, "wazuh-indexer", { target: "https://indexer2.example.invalid:9200", username: "portal_ro" }, "c");
    await service.bootstrap();
    expect((await service.effective("wazuh-indexer"))?.target).toBe("https://indexer2.example.invalid:9200");
    expect((await service.effective("wazuh-indexer"))?.secret).toBe("synthetic-env-password");
  });

  it("never returns the secret, only whether one is set", async () => {
    const { service } = setup();
    await service.bootstrap();
    await service.update(admin, "cloudflare", { target: "0123456789abcdef0123456789abcdef", secret: "synthetic-cf-token" }, "c");
    const listed = JSON.stringify(await service.list(admin));
    expect(listed).not.toContain("synthetic-cf-token");
    expect(listed).not.toContain("synthetic-env-password");
    expect(listed).not.toContain("v1.");
    const cf = (await service.list(admin)).find((c) => c.name === "cloudflare")!;
    expect(cf.secretSet).toBe(true);
    expect(cf.secretUpdatedAt).toBeInstanceOf(Date);
  });

  it("audits a secret change without the value", async () => {
    const { service, auditStore } = setup();
    await service.update(admin, "cloudflare", { target: "0123456789abcdef0123456789abcdef", secret: "synthetic-cf-token" }, "c");
    const entry = auditStore.records.at(-1)!;
    expect(entry.action).toBe("connector.settings_changed");
    expect(entry.metadata).toEqual({ changed: ["target", "credential"] });
    expect(JSON.stringify(auditStore.records)).not.toContain("synthetic-cf-token");
  });

  it("keeps the stored secret when the field is left blank", async () => {
    const { service } = setup();
    await service.update(admin, "cloudflare", { target: "0123456789abcdef0123456789abcdef", secret: "first-token" }, "c");
    await service.update(admin, "cloudflare", { target: "0123456789abcdef0123456789abcdef", secret: "" }, "c");
    expect((await service.effective("cloudflare"))?.secret).toBe("first-token");
  });

  it("validates targets and requires https for the indexer", async () => {
    const { service } = setup();
    await expect(service.update(admin, "wazuh-indexer", { target: "http://indexer.example.invalid", username: "x" }, "c")).rejects.toThrow(ConnectorSettingsError);
    await expect(service.update(admin, "cloudflare", { target: "not-a-zone" }, "c")).rejects.toThrow(ConnectorSettingsError);
  });

  it("is for administrators only", async () => {
    const { service } = setup();
    await expect(service.list(operator)).rejects.toThrow(ForbiddenError);
    await expect(service.update(operator, "cloudflare", { target: "0123456789abcdef0123456789abcdef" }, "c")).rejects.toThrow(ForbiddenError);
  });

  it("without an encryption key, falls back to the environment and refuses to save", async () => {
    const { service, store } = setup({ key: false });
    await service.bootstrap();
    expect(store.rows.size).toBe(0);
    expect((await service.effective("wazuh-indexer"))?.secret).toBe("synthetic-env-password");
    await expect(service.update(admin, "cloudflare", { target: "0123456789abcdef0123456789abcdef", secret: "t" }, "c")).rejects.toThrow(ConnectorSettingsError);
  });

  it("reports nothing configured for a connector with no record and no environment value", async () => {
    const { service } = setup({ env: {} });
    expect(await service.effective("cloudflare")).toBeNull();
  });
});
