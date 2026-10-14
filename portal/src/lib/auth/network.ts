import { ipInNetworks } from "../net";

/**
 * The Portal runs behind the hospital reverse proxy, which overwrites X-Real-IP
 * with the TCP peer address. X-Forwarded-For is client-controlled and ignored.
 */
export function clientIp(request: { headers: Headers }): string | null {
  return request.headers.get("x-real-ip")?.trim() || null;
}

export function isTrustedRequest(request: { headers: Headers }, trustedNetworks: readonly string[]): boolean {
  return ipInNetworks(clientIp(request), trustedNetworks);
}
