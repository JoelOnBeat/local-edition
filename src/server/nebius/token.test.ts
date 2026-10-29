import { describe, expect, it, vi } from "vitest";
import { cacheKey, createMemoryTokenCache, createTokenProvider, kvTokenCache, TOKEN_CACHE_TTL_SECONDS, TOKEN_EXCHANGE_URL, type TokenCache } from "./token";
import { FAKE_TOKEN, scriptedFetch, testKeys } from "./test-utils";

const ok = { body: { access_token: FAKE_TOKEN, issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 43200 } };

function setup(replies: Parameters<typeof scriptedFetch>, startMs = 1_800_000_000_000) {
  let t = startMs;
  const { fetchImpl, calls } = scriptedFetch(...replies);
  const cache = createMemoryTokenCache(() => t);
  const { credentials } = testKeys();
  const provider = createTokenProvider({ credentials, cache, fetchImpl, now: () => t });
  return { provider, calls, cache, credentials, advance: (ms: number) => (t += ms) };
}

describe("token exchange", () => {
  it("posts the documented form to the documented endpoint with a signed JWT", async () => {
    const s = setup([ok]);
    expect(await s.provider.getToken()).toBe(FAKE_TOKEN);
    expect(s.calls).toHaveLength(1);
    const [call] = s.calls;
    expect(call.url).toBe(TOKEN_EXCHANGE_URL);
    expect(call.url).toBe("https://auth.eu.nebius.com:443/oauth2/token/exchange");
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    });
    const jwt = form.get("subject_token") ?? "";
    expect(jwt.split(".")).toHaveLength(3);
    const claims = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims).toMatchObject({ iss: s.credentials.issuer, sub: s.credentials.subject, iat: 1_800_000_000 });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it("caches the token for 11.5 hours and reuses it without another exchange", async () => {
    const s = setup([ok]);
    const put = vi.spyOn(s.cache, "put");
    await s.provider.getToken();
    expect(put).toHaveBeenCalledWith(cacheKey(s.credentials), FAKE_TOKEN, TOKEN_CACHE_TTL_SECONDS);
    expect(TOKEN_CACHE_TTL_SECONDS).toBe(41_400);
    s.advance(60 * 60 * 1000);
    expect(await s.provider.getToken()).toBe(FAKE_TOKEN);
    expect(s.calls).toHaveLength(1);
  });

  it("a fresh isolate (empty memory) reads the token from the shared cache", async () => {
    const s = setup([ok]);
    await s.provider.getToken();
    const second = createTokenProvider({ credentials: s.credentials, cache: s.cache, fetchImpl: scriptedFetch(ok).fetchImpl, now: () => 1_800_000_001_000 });
    expect(await second.getToken()).toBe(FAKE_TOKEN);
    expect(s.calls).toHaveLength(1);
  });

  it("refreshes after the cache TTL has passed", async () => {
    const s = setup([ok, { body: { ...ok.body, access_token: `${FAKE_TOKEN}-2` } }]);
    await s.provider.getToken();
    s.advance((TOKEN_CACHE_TTL_SECONDS + 1) * 1000);
    expect(await s.provider.getToken()).toBe(`${FAKE_TOKEN}-2`);
    expect(s.calls).toHaveLength(2);
  });

  it("forceRefresh skips the cache and replaces the cached token", async () => {
    const s = setup([ok, { body: { ...ok.body, access_token: `${FAKE_TOKEN}-2` } }]);
    await s.provider.getToken();
    expect(await s.provider.getToken({ forceRefresh: true })).toBe(`${FAKE_TOKEN}-2`);
    expect(await s.provider.getToken()).toBe(`${FAKE_TOKEN}-2`);
    expect(s.calls).toHaveLength(2);
  });

  it("shares one exchange between concurrent callers", async () => {
    const s = setup([ok]);
    const tokens = await Promise.all([s.provider.getToken(), s.provider.getToken(), s.provider.getToken()]);
    expect(new Set(tokens)).toEqual(new Set([FAKE_TOKEN]));
    expect(s.calls).toHaveLength(1);
  });

  it("caps the cache TTL below a short expires_in and skips the cache when the token is nearly dead", async () => {
    const short = setup([{ body: { ...ok.body, expires_in: 3600 } }]);
    const put = vi.spyOn(short.cache, "put");
    await short.provider.getToken();
    expect(put).toHaveBeenCalledWith(expect.any(String), FAKE_TOKEN, 1800);
    const dying = setup([{ body: { ...ok.body, expires_in: 600 } }]);
    const put2 = vi.spyOn(dying.cache, "put");
    await dying.provider.getToken();
    expect(put2).not.toHaveBeenCalled();
  });

  it("still returns the token when the cache is broken", async () => {
    const { fetchImpl } = scriptedFetch(ok);
    const broken: TokenCache = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    const p = createTokenProvider({ credentials: testKeys().credentials, cache: broken, fetchImpl });
    expect(await p.getToken()).toBe(FAKE_TOKEN);
  });

  it.each([
    [400, { status: 400, message: "INVALID_ARGUMENT: Invalid JWT", error: "", error_description: "" }, "nebius_auth"],
    [401, { status: 401, message: "INVALID_ARGUMENT: Invalid JWT: malformed token or invalid claim format" }, "nebius_auth"],
    [429, { message: "too many requests" }, "nebius_quota"],
    [503, { message: "upstream down" }, "nebius_unavailable"],
  ])("maps HTTP %i from the exchange to %s", async (status, body, code) => {
    const s = setup([{ status, body }]);
    await expect(s.provider.getToken()).rejects.toMatchObject({ code, status });
  });

  it("maps a network failure and a malformed success body to nebius_unavailable", async () => {
    await expect(setup([new Error("connect ECONNRESET")]).provider.getToken()).rejects.toMatchObject({ code: "nebius_unavailable" });
    await expect(setup([{ body: { token_type: "Bearer" } }]).provider.getToken()).rejects.toMatchObject({ code: "nebius_unavailable" });
    await expect(setup([{ text: "<html>gateway</html>" }]).provider.getToken()).rejects.toMatchObject({ code: "nebius_unavailable" });
  });

  it("never puts the JWT or the token in an error message", async () => {
    const s = setup([{ status: 401, body: { message: `bad ${FAKE_TOKEN} eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.c2ln Bearer ${FAKE_TOKEN}` } }]);
    const err = await s.provider.getToken().catch((e: Error) => e);
    expect((err as Error).message).not.toContain(FAKE_TOKEN);
    expect((err as Error).message).not.toContain("eyJhbGci");
  });
});

describe("kvTokenCache", () => {
  it("adapts a Workers KV namespace and enforces KV's 60 second TTL floor", async () => {
    const store = new Map<string, string>();
    const puts: Array<{ ttl: number }> = [];
    const cache = kvTokenCache({
      get: async (k) => store.get(k) ?? null,
      put: async (k, v, o) => { store.set(k, v); puts.push({ ttl: o.expirationTtl }); },
    });
    await cache.put("k", "v", 10.7);
    await cache.put("k2", "v", 41_400);
    expect(puts).toEqual([{ ttl: 60 }, { ttl: 41_400 }]);
    expect(await cache.get("k")).toBe("v");
    expect(await cache.get("missing")).toBeNull();
  });
});
