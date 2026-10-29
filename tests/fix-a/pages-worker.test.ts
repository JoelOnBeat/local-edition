import { afterEach, describe, expect, it, vi } from "vitest";
import front from "../../edge/pages/public/_worker.js";
import { clientIp } from "@/server/limits";

/** The Pages front forwards to the product Worker over a service binding; the client address must survive the hop. */
function hop(headers: Record<string, string>) {
  const seen: Request[] = [];
  const env = { APP: { fetch: async (r: Request) => { seen.push(r); return new Response("ok"); } } };
  return { seen, run: () => front.fetch(new Request("https://localedition.pages.dev/api/workspace", { headers }), env) };
}

afterEach(() => vi.unstubAllEnvs());

describe("Pages _worker.js keeps cf-connecting-ip across the service-binding hop", () => {
  it("forwards the header, and the product Worker's clientIp reads the visitor, not 'unknown', in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = hop({ "cf-connecting-ip": "203.0.113.9" });
    await h.run();
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0].headers.get("cf-connecting-ip")).toBe("203.0.113.9");
    expect(clientIp(h.seen[0])).toBe("203.0.113.9");
  });

  it("keeps an IPv6 visitor, which the Worker then keys by its /64", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = hop({ "cf-connecting-ip": "2001:db8:aa:bb:1234:5678:9abc:def0" });
    await h.run();
    expect(clientIp(h.seen[0])).toBe("2001:db8:aa:bb::/64");
  });

  it("forwards the other headers, the cookie among them, untouched", async () => {
    const h = hop({ "cf-connecting-ip": "203.0.113.9", cookie: "le_ws=ws_abc", "x-forwarded-for": "6.6.6.6" });
    await h.run();
    expect(h.seen[0].headers.get("cookie")).toBe("le_ws=ws_abc");
    expect(h.seen[0].url).toBe("https://localedition.pages.dev/api/workspace");
  });

  it("passes a request without the header through unchanged (the Worker then treats it as 'unknown' in production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = hop({ "x-forwarded-for": "6.6.6.6" });
    await h.run();
    expect(clientIp(h.seen[0])).toBe("unknown");
  });
});
