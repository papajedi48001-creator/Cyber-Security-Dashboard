import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox, parseSettingsKey, SecretDecryptError } from "./secrets";

describe("secret box", () => {
  it("round-trips and never stores the plain text", () => {
    const box = createSecretBox(randomBytes(32));
    const sealed = box.encrypt("synthetic-password-1");
    expect(sealed).not.toContain("synthetic-password-1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(box.decrypt(sealed)).toBe("synthetic-password-1");
  });

  it("uses a fresh nonce each time", () => {
    const box = createSecretBox(randomBytes(32));
    expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
  });

  it("fails with the wrong key or a tampered value", () => {
    const sealed = createSecretBox(randomBytes(32)).encrypt("x");
    expect(() => createSecretBox(randomBytes(32)).decrypt(sealed)).toThrow(SecretDecryptError);
    const box = createSecretBox(randomBytes(32));
    const good = box.encrypt("x");
    const parts = good.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => box.decrypt(parts.join("."))).toThrow(SecretDecryptError);
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseSettingsKey(randomBytes(32).toString("base64"))?.length).toBe(32);
    expect(parseSettingsKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseSettingsKey(undefined)).toBeNull();
  });
});
