// IP and CIDR helpers without Node built-ins, so they also run in Next.js middleware.

export interface Network {
  version: 4 | 6;
  bits: bigint;
  prefix: number;
}

function parseIPv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIPv6(text: string): bigint | null {
  let address = text;
  let embeddedV4: bigint | null = null;
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".")) {
    embeddedV4 = parseIPv4(address.slice(lastColon + 1));
    if (embeddedV4 === null) return null;
    address = `${address.slice(0, lastColon)}:0:0`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  if (embeddedV4 !== null) value = ((value >> 32n) << 32n) | embeddedV4;
  return value;
}

function parseAddress(text: string): { version: 4 | 6; bits: bigint } | null {
  const v4 = parseIPv4(text);
  if (v4 !== null) return { version: 4, bits: v4 };
  const v6 = text.includes(":") ? parseIPv6(text) : null;
  if (v6 === null) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as IPv4.
  if (v6 >> 32n === 0xffffn) return { version: 4, bits: v6 & 0xffffffffn };
  return { version: 6, bits: v6 };
}

export function parseNetwork(text: string): Network | null {
  const [addressText, prefixText, ...extra] = text.trim().split("/");
  if (!addressText || extra.length) return null;
  const address = parseAddress(addressText);
  if (!address) return null;
  const max = address.version === 4 ? 32 : 128;
  let prefix = max;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > max) return null;
  }
  const shift = BigInt(max - prefix);
  return { version: address.version, bits: (address.bits >> shift) << shift, prefix };
}

export function ipInNetworks(ip: string | undefined | null, networks: readonly string[]): boolean {
  if (!ip) return false;
  const address = parseAddress(ip.trim());
  if (!address) return false;
  return networks.some((text) => {
    const network = parseNetwork(text);
    if (!network || network.version !== address.version) return false;
    const shift = BigInt((address.version === 4 ? 32 : 128) - network.prefix);
    return (address.bits >> shift) << shift === network.bits;
  });
}
