// Fixed, test-only configuration for the Portal under Playwright. Nothing here
// is a real secret; the TOTP key and passwords exist only for the e2e database.
export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? "mysql://portal:portal-test-only@127.0.0.1:3306/portal_test",
  SESSION_SECRET: "e2e-session-secret-not-for-production-use-0000",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
  PORTAL_BASE_URL: "https://portal.e2e.example",
  TRUSTED_NETWORKS: "192.0.2.0/24",
  WAZUH_INDEXER_URL: "https://127.0.0.1:9",
  WAZUH_DASHBOARD_URL: "https://wazuh.e2e.example",
  WAZUH_INDEXER_USERNAME: "svc-portal",
  WAZUH_INDEXER_PASSWORD: "e2e-only",
};

export const E2E_PASSWORD = "e2e-Password-2026!";

export const E2E_USERS = {
  admin: { username: "e2e-admin", displayName: "E2E Admin", role: "SECURITY_ADMINISTRATOR" },
  opA: { username: "e2e-op-a", displayName: "E2E Operator A", role: "SECURITY_OPERATOR" },
  opB: { username: "e2e-op-b", displayName: "E2E Operator B", role: "SECURITY_OPERATOR" },
  exec: { username: "e2e-exec", displayName: "E2E Executive", role: "EXECUTIVE_VIEWER" },
} as const;

export type E2ERole = keyof typeof E2E_USERS;
export const storageFile = (role: E2ERole) => `e2e/.auth/${role}.json`;
