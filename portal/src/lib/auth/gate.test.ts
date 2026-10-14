import { describe, expect, it } from "vitest";
import { gateRequest } from "./gate";

const NETWORKS = ["192.0.2.0/24"];
const trusted = new Headers({ "x-real-ip": "192.0.2.9" });
const untrusted = new Headers({ "x-real-ip": "203.0.113.9" });

describe("gateRequest", () => {
  it("forbids any path from an untrusted network, including the login page", () => {
    expect(gateRequest({ pathname: "/login", headers: untrusted, hasSessionCookie: false }, NETWORKS)).toBe("forbid");
    expect(gateRequest({ pathname: "/incidents", headers: untrusted, hasSessionCookie: true }, NETWORKS)).toBe("forbid");
  });

  it("sends unauthenticated users on trusted networks to the login page", () => {
    expect(gateRequest({ pathname: "/incidents", headers: trusted, hasSessionCookie: false }, NETWORKS)).toBe("login");
  });

  it("allows public pages and requests carrying a session cookie", () => {
    expect(gateRequest({ pathname: "/login", headers: trusted, hasSessionCookie: false }, NETWORKS)).toBe("allow");
    expect(gateRequest({ pathname: "/incidents", headers: trusted, hasSessionCookie: true }, NETWORKS)).toBe("allow");
  });
});
