import { HttpError } from "../http/errors";

/**
 * The chain's own site URL, which Tavily will crawl. It must be a public http(s) address: no credentials,
 * no localhost or internal names, no private, loopback, link-local or metadata IP literals. The URL parser
 * has already turned decimal, hex and octal IPv4 spellings into dotted form, so the checks see one shape.
 * A hostname that merely resolves to a private address cannot be seen from a Worker; Tavily's own crawler
 * is what fetches the page, so the service is never asked to reach our network.
 */

const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".test", ".invalid", ".example"];

function ipv4Private(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function ipv6Private(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (rest.includes(".")) return ipv4Private(rest);
    const parts = rest.split(":").map((p) => parseInt(p, 16));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return ipv4Private(`${parts[0] >> 8}.${parts[0] & 255}.${parts[1] >> 8}.${parts[1] & 255}`);
    }
    return true;
  }
  return false;
}

/** Throws HttpError 400 `invalid_url` or `private_url`; returns the parsed URL with the hash dropped. */
export function assertPublicSiteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "invalid_url", "Enter the full address of the chain's website, starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "invalid_url", "The website address must start with http:// or https://.");
  }
  if (url.username || url.password) throw new HttpError(400, "invalid_url", "The website address must not contain a username or password.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":");
  const internalName = host === "localhost" || (!host.includes(".") && !isIp) || INTERNAL_SUFFIXES.some((s) => host.endsWith(s));
  if (internalName || ipv4Private(bare) || ipv6Private(host)) {
    throw new HttpError(400, "private_url", "That address is not a public website. Use the chain's own public site.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new HttpError(400, "invalid_url", "Use the website's normal address, without a custom port.");
  }
  url.hash = "";
  return url;
}
