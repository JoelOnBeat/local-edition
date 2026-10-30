import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-types";
import { AUTH_ERROR_CODES, AuthResult, MeResponse, OnboardingState } from "@/contract";
import { MOCK_PASSWORD, MOCK_USER, mockAuthResult, mockSignedIn, mockSignedOut } from "@/mocks";

const fetchOf = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { impl, calls };
};

describe("api-client accounts (http)", () => {
  it("posts sign-up as JSON with the cookie jar on, and parses the answer with the contract", async () => {
    const { impl, calls } = fetchOf(200, mockAuthResult());
    const api = createApiClient({ mode: "app", fetchImpl: impl });
    const out = await api.signUp({ name: "Maya", email: "maya@kettleandkiln.example", password: "correct horse battery", chainName: "Kettle & Kiln" });
    expect(AuthResult.safeParse(out).success).toBe(true);
    expect(calls[0].url).toBe("/api/auth/signup");
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(calls[0].init!.body as string)).toMatchObject({ chainName: "Kettle & Kiln" });
  });

  it("maps a 429 to ApiClientError with the Retry-After seconds, code and plain message", async () => {
    const { impl } = fetchOf(429, { error: "Too many wrong passwords. Wait 30 seconds and try again.", code: "too_many_attempts" }, { "retry-after": "30" });
    const api = createApiClient({ mode: "app", fetchImpl: impl });
    const err = await api.signIn({ email: "maya@kettleandkiln.example", password: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 429, code: "too_many_attempts", retryAfterSeconds: 30 });
  });

  it("calls me, sign-out, delete (with the password in the body), and both onboarding routes", async () => {
    const onboarding = OnboardingState.parse({ steps: [], current: null, complete: false, updatedAt: null });
    const { impl, calls } = fetchOf(200, { ok: true });
    const api = createApiClient({ mode: "app", fetchImpl: impl });
    await api.signOut();
    await api.deleteAccount("correct horse battery");
    const second = fetchOf(200, onboarding);
    const api2 = createApiClient({ mode: "app", fetchImpl: second.impl });
    await api2.getOnboarding();
    await api2.updateOnboarding({ skip: ["tools"] });
    expect(calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual(["POST /api/auth/signout", "DELETE /api/account"]);
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({ password: "correct horse battery" });
    expect(second.calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual(["GET /api/onboarding", "PUT /api/onboarding"]);
    const me = fetchOf(200, mockSignedOut());
    expect(MeResponse.safeParse(await createApiClient({ mode: "app", fetchImpl: me.impl }).getMe()).success).toBe(true);
  });

  it("rejects an answer that does not match the contract", async () => {
    const { impl } = fetchOf(200, { user: "nope" });
    await expect(createApiClient({ mode: "app", fetchImpl: impl }).getMe()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("api-client accounts (mock backend)", () => {
  const api = () => createApiClient({ mode: "mock", mockDelayMs: 0, mockEventDelayMs: 0 });

  it("signs up, signs out, rejects a wrong password with the real error code, signs in, deletes", async () => {
    const mock = api();
    expect((await mock.getMe()).user).toBeNull();
    const made = await mock.signUp({ name: "Ines Duarte", email: "Ines@Birch.example", password: "another long password", chainName: "Birch Coffee" });
    expect(made.user.email).toBe("ines@birch.example");
    expect((await mock.getMe()).user?.name).toBe("Ines Duarte");
    await expect(mock.signUp({ name: "Dup", email: "ines@birch.example", password: "another long password", chainName: "x" })).rejects.toMatchObject({ status: 409, code: "email_taken" });
    await mock.signOut();
    await expect(mock.signIn({ email: "ines@birch.example", password: "wrong wrong wrong" })).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
    await mock.signIn({ email: "ines@birch.example", password: "another long password" });
    await expect(mock.deleteAccount("nope nope nope nope")).rejects.toMatchObject({ code: "invalid_credentials" });
    await mock.deleteAccount("another long password");
    expect((await mock.getMe()).user).toBeNull();
    await expect(mock.signIn({ email: "ines@birch.example", password: "another long password" })).rejects.toMatchObject({ status: 401 });
  });

  it("serves the seeded sample account and onboarding that follows the mock data", async () => {
    const mock = api();
    await mock.signIn({ email: MOCK_USER.email, password: MOCK_PASSWORD });
    expect((await mock.getMe()).workspace?.kind).toBe("account");
    const s = await mock.getOnboarding();
    expect(OnboardingState.safeParse(s).success).toBe(true);
    expect(s.steps.find((x) => x.id === "menu")?.status).toBe("done"); // the mock workspace is the sample chain
    await expect(mock.updateOnboarding({ skip: ["menu"] })).rejects.toMatchObject({ code: "not_skippable" });
    const skipped = await mock.updateOnboarding({ skip: ["tools"] });
    expect(skipped.steps.find((x) => x.id === "tools")?.status).toBe("skipped");
  });

  it("mock fixtures parse and every error code the screens must handle is declared with a status", () => {
    expect(MeResponse.parse(mockSignedIn()).user?.email).toBe(MOCK_USER.email);
    expect(Object.keys(AUTH_ERROR_CODES).sort()).toEqual(["bad_origin", "email_taken", "invalid_credentials", "invalid_input", "not_skippable", "rate_limited", "too_many_attempts", "unauthenticated"]);
  });
});
