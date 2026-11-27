// Encryption at rest for connector and sign-in secrets (ADR 0011, ADR 0012).
// AES-256-GCM with SETTINGS_ENCRYPTION_KEY from the environment; the key never
// enters the database. Stored form: v1.<nonce>.<tag>.<ciphertext>, base64 parts.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretDecryptError extends Error {
  constructor() {
    super("Stored secret could not be decrypted with the configured SETTINGS_ENCRYPTION_KEY");
    this.name = "SecretDecryptError";
  }
}

export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

export function parseSettingsKey(text: string | undefined): Buffer | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const key = Buffer.from(trimmed, "base64");
  return key.length === 32 ? key : null;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("settings encryption key must be 32 bytes");
  return {
    encrypt(plain) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", nonce, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(".");
    },
    decrypt(sealed) {
      const [version, nonce, tag, body] = sealed.split(".");
      if (version !== "v1" || !nonce || !tag || body === undefined) throw new SecretDecryptError();
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretDecryptError();
      }
    },
  };
}
