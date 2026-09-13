import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(ip: string) {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(ip: string) {
  const value = ip.toLowerCase();
  return value === "::1"
    || value === "::"
    || value.startsWith("fe80:")
    || value.startsWith("fc")
    || value.startsWith("fd")
    || value.startsWith("::ffff:127.")
    || value.startsWith("::ffff:10.")
    || value.startsWith("::ffff:192.168.");
}

function addressIsPrivate(address: string) {
  const kind = isIP(address);
  if (kind === 4) return isPrivateIpv4(address);
  if (kind === 6) return isPrivateIpv6(address);
  return true;
}

export async function assertPublicHttpUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Ungültige Website-URL.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Nur öffentliche HTTP/HTTPS-Websites sind erlaubt.");
  if (parsed.username || parsed.password) throw new Error("URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Lokale oder interne Ziele sind für Website-Research gesperrt.");
  }
  if (isIP(hostname) && addressIsPrivate(hostname)) throw new Error("Private IP-Ziele sind für Website-Research gesperrt.");

  const resolved = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!resolved.length) throw new Error("Die Website-Domain konnte nicht aufgelöst werden.");
  if (resolved.some(item => addressIsPrivate(item.address))) throw new Error("Die Website zeigt auf ein internes/privates Netzwerk und wurde blockiert.");

  parsed.hash = "";
  return parsed.toString();
}
