import { parseNetwork } from "./net";
import type { EmailSettings } from "./notifications/channels";

export interface PortalConfig {
  databaseUrl: string;
  sessionSecret: string;
  totpEncryptionKey: Buffer;
  portalBaseUrl: string;
  trustedNetworks: string[];
  timeZone: "Asia/Bangkok";
  wazuh: {
    indexerUrl: string;
    dashboardUrl: string;
    username: string;
    password: string;
    pollIntervalSeconds: number;
    caCertPath?: string;
  };
  notifications: {
    email?: EmailSettings;
    line?: { accessToken: string; to: string };
  };
  cloudflare?: { apiToken: string; zoneId: string };
  /** Provider ID Login (ADR 0009). Client credentials are added with the real adapter. */
  providerId?: { hospitalCode: string };
}

/** Thrown at startup. Names the variables at fault and never includes their values. */
export class ConfigError extends Error {
  constructor(readonly variables: string[], problems: string[]) {
    super(`Invalid Portal configuration:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const MIN_SECRET_LENGTH = 32;
const MAX_POLL_INTERVAL_SECONDS = 60;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): PortalConfig {
  const variables: string[] = [];
  const problems: string[] = [];
  const fail = (name: string, problem: string) => {
    variables.push(name);
    problems.push(`${name}: ${problem}`);
  };
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      fail(name, "is required");
      return "";
    }
    return value;
  };

  const databaseUrl = required("DATABASE_URL");
  if (databaseUrl && !/^mysql:\/\//.test(databaseUrl)) fail("DATABASE_URL", "must be a mysql:// URL for the Portal MariaDB");

  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < MIN_SECRET_LENGTH)
    fail("SESSION_SECRET", `must be at least ${MIN_SECRET_LENGTH} characters`);

  const totpKeyText = required("TOTP_ENCRYPTION_KEY");
  const totpEncryptionKey = Buffer.from(totpKeyText, "base64");
  if (totpKeyText && totpEncryptionKey.length !== 32) fail("TOTP_ENCRYPTION_KEY", "must be 32 bytes, base64-encoded");

  const portalBaseUrl = required("PORTAL_BASE_URL");
  if (portalBaseUrl && !isHttpsUrl(portalBaseUrl)) fail("PORTAL_BASE_URL", "must be an https:// URL");

  const indexerUrl = required("WAZUH_INDEXER_URL");
  if (indexerUrl && !isHttpsUrl(indexerUrl)) fail("WAZUH_INDEXER_URL", "must be an https:// URL");
  const dashboardUrl = required("WAZUH_DASHBOARD_URL");
  if (dashboardUrl && !isHttpsUrl(dashboardUrl)) fail("WAZUH_DASHBOARD_URL", "must be an https:// URL");
  const username = required("WAZUH_INDEXER_USERNAME");
  const password = required("WAZUH_INDEXER_PASSWORD");

  const trustedText = required("TRUSTED_NETWORKS");
  const trustedNetworks = trustedText
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (trustedText) {
    const parsed = trustedNetworks.map(parseNetwork);
    if (parsed.some((n) => n === null)) fail("TRUSTED_NETWORKS", "must be a comma-separated list of IP addresses or CIDRs");
    else if (parsed.some((n) => n!.prefix === 0)) fail("TRUSTED_NETWORKS", "must not include a network that allows every address");
  }

  let pollIntervalSeconds = MAX_POLL_INTERVAL_SECONDS;
  const pollText = env.WAZUH_POLL_INTERVAL_SECONDS?.trim();
  if (pollText) {
    pollIntervalSeconds = Number(pollText);
    if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 5 || pollIntervalSeconds > MAX_POLL_INTERVAL_SECONDS)
      fail("WAZUH_POLL_INTERVAL_SECONDS", `must be an integer between 5 and ${MAX_POLL_INTERVAL_SECONDS}`);
  }

  // Notification channels are optional individually; the Portal shows when none is set.
  let email: EmailSettings | undefined;
  const smtpHost = env.SMTP_HOST?.trim();
  if (smtpHost) {
    const port = Number(env.SMTP_PORT?.trim() || "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("SMTP_PORT", "must be a TCP port number");
    const from = required("SMTP_FROM");
    const to = required("NOTIFY_EMAIL_TO")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (to.some((a) => !/^[^\s@]+@[^\s@]+$/.test(a))) fail("NOTIFY_EMAIL_TO", "must be a comma-separated list of email addresses");
    const user = env.SMTP_USER?.trim() || undefined;
    if (user && !env.SMTP_PASSWORD) fail("SMTP_PASSWORD", "is required when SMTP_USER is set");
    email = { host: smtpHost, port, user, password: user ? env.SMTP_PASSWORD : undefined, from, to };
  }
  let line: { accessToken: string; to: string } | undefined;
  const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (lineToken) line = { accessToken: lineToken, to: required("LINE_TO") };

  let cloudflare: { apiToken: string; zoneId: string } | undefined;
  const cfToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (cfToken) {
    const zoneId = required("CLOUDFLARE_ZONE_ID");
    if (zoneId && !/^[0-9a-f]{32}$/.test(zoneId)) fail("CLOUDFLARE_ZONE_ID", "must be the 32-character zone ID");
    cloudflare = { apiToken: cfToken, zoneId };
  }

  let providerId: { hospitalCode: string } | undefined;
  const hospitalCode = env.PROVIDER_ID_HOSPITAL_CODE?.trim();
  if (hospitalCode) {
    if (!/^\d{5}$/.test(hospitalCode)) fail("PROVIDER_ID_HOSPITAL_CODE", "must be the five-digit health facility code");
    providerId = { hospitalCode };
  }

  if (problems.length) throw new ConfigError(variables, problems);

  return {
    databaseUrl,
    sessionSecret,
    totpEncryptionKey,
    portalBaseUrl: portalBaseUrl.replace(/\/$/, ""),
    trustedNetworks,
    timeZone: "Asia/Bangkok",
    wazuh: {
      indexerUrl: indexerUrl.replace(/\/$/, ""),
      dashboardUrl: dashboardUrl.replace(/\/$/, ""),
      username,
      password,
      pollIntervalSeconds,
      caCertPath: env.WAZUH_INDEXER_CA_CERT?.trim() || undefined,
    },
    notifications: { email, line },
    cloudflare,
    providerId,
  };
}
