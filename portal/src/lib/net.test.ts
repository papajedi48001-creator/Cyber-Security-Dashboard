import { describe, expect, it } from "vitest";
import { ipInNetworks, parseNetwork } from "./net";

describe("parseNetwork", () => {
  it("parses IPv4 and IPv6 CIDRs and single addresses", () => {
    expect(parseNetwork("192.0.2.0/24")?.prefix).toBe(24);
    expect(parseNetwork("192.0.2.7")?.prefix).toBe(32);
    expect(parseNetwork("2001:db8::/32")?.prefix).toBe(32);
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "192.0.2.0/33", "300.1.1.1", "abc", "2001:db8::/129", "1.2.3"]) {
      expect(parseNetwork(bad)).toBeNull();
    }
  });
});

describe("ipInNetworks", () => {
  const networks = ["192.0.2.0/24", "2001:db8:1::/48"];

  it("matches addresses inside the trusted networks", () => {
    expect(ipInNetworks("192.0.2.200", networks)).toBe(true);
    expect(ipInNetworks("2001:db8:1::5", networks)).toBe(true);
    expect(ipInNetworks("::ffff:192.0.2.9", networks)).toBe(true);
  });

  it("rejects addresses outside, unknown or malformed", () => {
    expect(ipInNetworks("198.51.100.1", networks)).toBe(false);
    expect(ipInNetworks("2001:db8:2::1", networks)).toBe(false);
    expect(ipInNetworks(undefined, networks)).toBe(false);
    expect(ipInNetworks("garbage", networks)).toBe(false);
  });
});
