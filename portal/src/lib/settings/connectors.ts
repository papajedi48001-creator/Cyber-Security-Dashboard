// Connector settings owned by the core (ADR 0011). Targets and read-only account
// names are stored as records; secrets are encrypted with SETTINGS_ENCRYPTION_KEY
// and are write-only: views carry secretSet and secretUpdatedAt, never the value.
// Environment values seed a record once, when none exists.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import { MODULES } from "../modules/registry";
import type { SecretBox } from "./secrets";

export type ConnectorName = "wazuh-indexer" | "cloudflare";

interface ConnectorDefinition {
  name: ConnectorName;
  label: string;
  targetLabel: string;
  usernameLabel: string | null;
  secretLabel: string;
  /** Name in ConnectorState for last success and error. */
  stateName: string;
  validateTarget(target: string): string | null;
}

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const CONNECTOR_DEFINITIONS: readonly ConnectorDefinition[] = [
  {
    name: "wazuh-indexer",
    label: "Wazuh Indexer",
    targetLabel: "URL ของ Indexer (https)",
    usernameLabel: "บัญชีอ่านอย่างเดียว",
    secretLabel: "รหัสผ่าน",
    stateName: "wazuh-indexer",
    validateTarget: (t) => (isHttps(t) ? null : "URL ต้องขึ้นต้นด้วย https://"),
  },
  {
    name: "cloudflare",
    label: "Cloudflare",
    targetLabel: "Zone ID",
    usernameLabel: null,
    secretLabel: "API token (สิทธิ์อ่านอย่างเดียว)",
    stateName: "cloudflare",
    validateTarget: (t) => (/^[0-9a-f]{32}$/.test(t) ? null : "Zone ID ต้องเป็นตัวอักษร 0-9 a-f จำนวน 32 ตัว"),
  },
];

export interface ConnectorRecord {
  name: ConnectorName;
  target: string;
  username: string | null;
  secretEnc: string | null;
  secretUpdatedAt: Date | null;
  updatedAt: Date;
  updatedBy: string;
}

export interface ConnectorStore {
  get(name: ConnectorName): Promise<ConnectorRecord | null>;
  put(record: ConnectorRecord): Promise<void>;
}

export interface EffectiveConnector {
  target: string;
  username: string | null;
  secret: string | null;
}

export type ConnectorEnvDefaults = Partial<Record<ConnectorName, EffectiveConnector>>;

export interface ConnectorView {
  name: ConnectorName;
  label: string;
  targetLabel: string;
  usernameLabel: string | null;
  secretLabel: string;
  target: string | null;
  username: string | null;
  secretSet: boolean;
  secretUpdatedAt: Date | null;
  /** Where the values in use come from. */
  source: "record" | "environment" | "none";
  scope: "read-only";
  modules: string[];
  lastSuccessAt: Date | null;
  lastError: string | null;
}

export class ConnectorSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorSettingsError";
  }
}

const SYSTEM = { id: null, label: "system:settings" };

function definition(name: string): ConnectorDefinition {
  const def = CONNECTOR_DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new ConnectorSettingsError("ไม่รู้จัก connector นี้");
  return def;
}

export function createConnectorSettings(deps: {
  store: ConnectorStore;
  audit: AuditLog;
  /** Null when SETTINGS_ENCRYPTION_KEY is not set: records cannot be written. */
  box: SecretBox | null;
  env: ConnectorEnvDefaults;
  status: (stateName: string) => Promise<{ lastSuccessAt: Date | null; lastError: string | null }>;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());

  async function effective(name: ConnectorName): Promise<EffectiveConnector | null> {
    const record = deps.box ? await deps.store.get(name) : null;
    if (record && deps.box) {
      return { target: record.target, username: record.username, secret: record.secretEnc ? deps.box.decrypt(record.secretEnc) : null };
    }
    return deps.env[name] ?? null;
  }

  return {
    encryptionReady: deps.box !== null,
    effective,

    /** Seeds a record from the environment for each connector that has none. */
    async bootstrap(correlationId = "bootstrap") {
      if (!deps.box) return;
      for (const def of CONNECTOR_DEFINITIONS) {
        const seed = deps.env[def.name];
        if (!seed || (await deps.store.get(def.name))) continue;
        const now = clock();
        await deps.store.put({
          name: def.name,
          target: seed.target,
          username: seed.username,
          secretEnc: seed.secret ? deps.box.encrypt(seed.secret) : null,
          secretUpdatedAt: seed.secret ? now : null,
          updatedAt: now,
          updatedBy: SYSTEM.label,
        });
        await deps.audit.append({ actor: SYSTEM, action: "connector.bootstrapped", target: { type: "Connector", id: def.name }, correlationId });
      }
    },

    async list(actor: Principal): Promise<ConnectorView[]> {
      requirePermission(actor, "config.manage");
      return Promise.all(
        CONNECTOR_DEFINITIONS.map(async (def) => {
          const record = deps.box ? await deps.store.get(def.name) : null;
          const env = deps.env[def.name];
          const state = await deps.status(def.stateName);
          return {
            name: def.name,
            label: def.label,
            targetLabel: def.targetLabel,
            usernameLabel: def.usernameLabel,
            secretLabel: def.secretLabel,
            target: record?.target ?? env?.target ?? null,
            username: record?.username ?? env?.username ?? null,
            secretSet: record ? record.secretEnc !== null : Boolean(env?.secret),
            secretUpdatedAt: record?.secretUpdatedAt ?? null,
            source: record ? "record" : env ? "environment" : "none",
            scope: "read-only",
            modules: MODULES.filter((m) => m.connectors.includes(def.name)).map((m) => m.name),
            lastSuccessAt: state.lastSuccessAt,
            lastError: state.lastError,
          } satisfies ConnectorView;
        }),
      );
    },

    async update(
      actor: Principal & { username: string },
      name: string,
      input: { target: string; username?: string; secret?: string },
      correlationId: string,
    ) {
      requirePermission(actor, "config.manage");
      const def = definition(name);
      if (!deps.box) throw new ConnectorSettingsError("ยังไม่ได้ตั้งค่า SETTINGS_ENCRYPTION_KEY จึงบันทึกรหัสไม่ได้");
      const target = input.target.trim();
      const problem = def.validateTarget(target);
      if (problem) throw new ConnectorSettingsError(problem);
      const username = def.usernameLabel ? input.username?.trim() || null : null;
      if (def.usernameLabel && !username) throw new ConnectorSettingsError(`ต้องระบุ${def.usernameLabel}`);
      const secret = input.secret ?? "";

      const previous = await deps.store.get(def.name);
      const now = clock();
      const changed: string[] = [];
      if (previous?.target !== target) changed.push("target");
      if ((previous?.username ?? null) !== username) changed.push("username");
      if (secret) changed.push("credential");
      if (!secret && !previous?.secretEnc && !deps.env[def.name]?.secret)
        throw new ConnectorSettingsError(`ต้องระบุ${def.secretLabel}`);
      if (changed.length === 0) return;

      // A blank secret keeps the stored one, or seeds it from the environment on the first save.
      const keptSecret = previous?.secretEnc ?? (deps.env[def.name]?.secret ? deps.box.encrypt(deps.env[def.name]!.secret!) : null);
      await deps.store.put({
        name: def.name,
        target,
        username,
        secretEnc: secret ? deps.box.encrypt(secret) : keptSecret,
        secretUpdatedAt: secret ? now : (previous?.secretUpdatedAt ?? (keptSecret ? now : null)),
        updatedAt: now,
        updatedBy: actor.id,
      });
      await deps.audit.append({
        actor: { id: actor.id, label: actor.username },
        action: "connector.settings_changed",
        target: { type: "Connector", id: def.name },
        metadata: { changed },
        correlationId,
      });
    },
  };
}

export type ConnectorSettings = ReturnType<typeof createConnectorSettings>;

/** Test and development store. */
export class InMemoryConnectorStore implements ConnectorStore {
  readonly rows = new Map<ConnectorName, ConnectorRecord>();
  async get(name: ConnectorName) {
    return this.rows.get(name) ?? null;
  }
  async put(record: ConnectorRecord) {
    this.rows.set(record.name, { ...record });
  }
}
