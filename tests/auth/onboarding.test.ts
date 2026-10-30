import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS, type Chain } from "@/contract";
import { computeOnboarding, EMPTY_ONBOARDING, type OnboardingFacts } from "@/lib/onboarding";
import { buildRoute } from "@/server/agent/handlers";
import { getOnboardingRoute, putOnboardingRoute, signinRoute, signupRoute } from "@/server/auth/handlers";
import { createStore, getWorkspace, putChain, putMenu } from "@/server/handlers/workspace";
import { SAMPLE_ANCHORS } from "@/server/sample/chain";
import { Jar, PASSWORD, call, signupBody, authRig } from "./helpers";

authRig();

const chain = (over: Partial<Chain> = {}): Chain => ({
  id: "chain_t", name: "Kettle & Kiln", category: "coffee", brandVoice: [], anchors: [], city: { name: "New York", lat: 40.7306, lon: -73.9866 }, isSample: false, ...over,
});
const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ chain: chain(), menuItems: 0, stores: 0, builtStores: 0, tools: [], ...over });
const statuses = (s: ReturnType<typeof computeOnboarding>) => Object.fromEntries(s.steps.map((x) => [x.id, x.status]));

describe("computeOnboarding", () => {
  it("lists every step in order, all open for a new chain, with what is missing", () => {
    const s = computeOnboarding(facts(), null);
    expect(s.steps.map((x) => x.id)).toEqual([...ONBOARDING_STEPS]);
    expect(Object.values(statuses(s)).every((v) => v === "todo")).toBe(true);
    expect(s.current).toBe("basics");
    expect(s.complete).toBe(false);
    for (const step of s.steps) expect(step.missing.length, step.id).toBeGreaterThan(0);
    const build = s.steps.find((x) => x.id === "build")!;
    expect(build.blockedBy).toEqual(["menu", "stores", "anchors"]);
    expect(s.steps.filter((x) => x.optional).map((x) => x.id)).toEqual(["voice", "tools"]);
  });

  it("reads done from the data, so a step turns done when its data appears from anywhere", () => {
    const s = computeOnboarding(facts({ menuItems: 12, stores: 3, chain: chain({ anchors: SAMPLE_ANCHORS.slice(0, 2), brandVoice: ["Warm and plain-spoken."] }) }), { ...EMPTY_ONBOARDING, basicsConfirmed: true });
    expect(statuses(s)).toMatchObject({ basics: "done", menu: "done", stores: "done", voice: "done", anchors: "done", tools: "todo", build: "todo" });
    const build = s.steps.find((x) => x.id === "build")!;
    expect(build.blockedBy).toEqual([]);
    expect(build.missing).toEqual(["Build the first editions."]);
    expect(s.steps.find((x) => x.id === "menu")!.missing).toEqual([]);
    expect(s.current).toBe("tools");
  });

  it("reports skipped for optional steps only, and complete once nothing is open", () => {
    const base = facts({ menuItems: 5, stores: 2, builtStores: 2, chain: chain({ anchors: SAMPLE_ANCHORS.slice(0, 1) }) });
    const memory = { ...EMPTY_ONBOARDING, basicsConfirmed: true, skipped: ["voice", "tools", "menu"] as never };
    const s = computeOnboarding(base, memory);
    expect(statuses(s)).toMatchObject({ voice: "skipped", tools: "skipped", menu: "done" }); // a required step is never "skipped": it is done or it is open
    expect(s.complete).toBe(true);
    expect(s.current).toBeNull();
    expect(s.steps.find((x) => x.id === "voice")!.missing).toEqual([]);
    expect(computeOnboarding(facts({ menuItems: 1 }), { ...EMPTY_ONBOARDING, skipped: ["menu"] }).steps.find((x) => x.id === "menu")!.status).toBe("done");
    expect(computeOnboarding(facts(), { ...EMPTY_ONBOARDING, skipped: ["stores"] }).steps.find((x) => x.id === "stores")!.status).toBe("todo");
  });

  it("a connected tool makes the optional tools step done, and a saved pointer is honoured only while its step is open", () => {
    expect(computeOnboarding(facts({ tools: ["slack"] }), null).steps.find((x) => x.id === "tools")!.status).toBe("done");
    expect(computeOnboarding(facts(), { ...EMPTY_ONBOARDING, current: "anchors" }).current).toBe("anchors");
    expect(computeOnboarding(facts({ menuItems: 3 }), { ...EMPTY_ONBOARDING, current: "menu" }).current).toBe("basics"); // menu is done: back to the first open step
  });
});

describe("GET and PUT /api/onboarding", () => {
  async function newAccount() {
    const jar = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody(), jar });
    return jar;
  }
  const put = (jar: Jar, body: unknown) => call(putOnboardingRoute, "/api/onboarding", { method: "PUT", jar, body });

  it("a new account starts at chain basics with every step open", async () => {
    const jar = await newAccount();
    const res = await call(getOnboardingRoute, "/api/onboarding", { jar });
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.current).toBe("basics");
    expect(s.complete).toBe(false);
    expect(s.updatedAt).toBeNull();
    expect(s.steps).toHaveLength(7);
  });

  it("saving the basics changes the chain and confirms the step; progress survives a new session", async () => {
    const jar = await newAccount();
    const res = await put(jar, { basics: { name: "Kettle & Kiln Roasters", category: "coffee", city: { name: "Brooklyn", lat: 40.6782, lon: -73.9442 } } });
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.steps[0]).toMatchObject({ id: "basics", status: "done", missing: [] });
    expect(s.current).toBe("menu");
    const bundle = await (await call(getWorkspace, "/api/workspace", { jar })).json();
    expect(bundle.chain).toMatchObject({ name: "Kettle & Kiln Roasters", city: { name: "Brooklyn", lat: 40.6782, lon: -73.9442 }, isSample: false });

    const back = new Jar(); // a different browser, a new session
    await call(signinRoute, "/api/auth/signin", { body: { email: "maya@kettleandkiln.example", password: PASSWORD }, jar: back });
    const again = await (await call(getOnboardingRoute, "/api/onboarding", { jar: back })).json();
    expect(again.steps[0].status).toBe("done");
    expect(again.updatedAt).not.toBeNull();
  });

  it("skips only the optional steps, un-skips, and rejects the rest with not_skippable", async () => {
    const jar = await newAccount();
    const refused = await put(jar, { skip: ["voice", "menu"] });
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("not_skippable");
    const ok = await (await put(jar, { skip: ["voice", "tools"] })).json();
    expect(ok.steps.filter((x: { status: string }) => x.status === "skipped").map((x: { id: string }) => x.id)).toEqual(["voice", "tools"]);
    const undone = await (await put(jar, { unskip: ["voice"] })).json();
    expect(undone.steps.find((x: { id: string }) => x.id === "voice").status).toBe("todo");
    expect(undone.steps.find((x: { id: string }) => x.id === "tools").status).toBe("skipped");
  });

  it("follows the data: adding a store from another screen turns the step done", async () => {
    const jar = await newAccount();
    await call(createStore, "/api/stores", { body: { name: "Williamsburg", addressLabel: "Bedford Ave & N 7th St", lat: 40.7175, lon: -73.9573 }, jar });
    await call(putMenu, "/api/menu", { method: "PUT", jar, body: [{ id: "menu_flat_white", name: "Flat white", category: "coffee", price: 4.5, currency: "USD", description: null, source: "manual", seen: true, priceLegible: true }] });
    await call(putChain, "/api/chain", { method: "PUT", jar, body: { name: "Kettle & Kiln", brandVoice: ["Warm and plain-spoken."], anchors: SAMPLE_ANCHORS.slice(0, 1) } });
    const s = await (await call(getOnboardingRoute, "/api/onboarding", { jar })).json();
    expect(Object.fromEntries(s.steps.map((x: { id: string; status: string }) => [x.id, x.status]))).toMatchObject({ menu: "done", stores: "done", voice: "done", anchors: "done", build: "todo" });
    expect(s.steps.find((x: { id: string }) => x.id === "build").blockedBy).toEqual([]);
  });

  it("validates input: empty body, unknown step, out-of-range city", async () => {
    const jar = await newAccount();
    for (const body of [{}, { skip: ["nope"] }, { basics: { city: { name: "X", lat: 91, lon: 0 } } }, { basics: { category: "bank" } }, { current: "elsewhere" }]) {
      const res = await put(jar, body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_input");
    }
    expect((await call(putOnboardingRoute, "/api/onboarding", { method: "PUT", jar, body: { skip: ["tools"] }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("onboarding of one account is invisible to another", async () => {
    const a = await newAccount();
    await put(a, { skip: ["tools"], basics: { name: "Alder Coffee" } });
    const b = new Jar();
    await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: "b@kettleandkiln.example", chainName: "Birch Coffee" }), jar: b });
    const s = await (await call(getOnboardingRoute, "/api/onboarding", { jar: b })).json();
    expect(s.steps.find((x: { id: string }) => x.id === "tools").status).toBe("todo");
    expect(s.steps[0].status).toBe("todo");
  });

  it("a build is refused until a taste anchor exists (409 no_anchors), and a store first (409 no_stores)", async () => {
    const jar = await newAccount();
    const none = await call(buildRoute, "/api/editions/build", { jar, body: {} });
    expect(none.status).toBe(409);
    expect((await none.json()).code).toBe("no_stores");
    await call(createStore, "/api/stores", { body: { name: "Williamsburg", addressLabel: "Bedford Ave & N 7th St", lat: 40.7175, lon: -73.9573 }, jar });
    const noAnchors = await call(buildRoute, "/api/editions/build", { jar, body: {} });
    expect(noAnchors.status).toBe(409);
    expect((await noAnchors.json()).code).toBe("no_anchors");
  });
});
