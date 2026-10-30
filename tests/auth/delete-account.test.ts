import { afterAll, describe, expect, it } from "vitest";
import { setAuthStore } from "@/server/auth";
import { D1AuthStore } from "@/server/auth/store-d1";
import { deleteAccountRoute, meRoute, signinRoute, signupRoute, putOnboardingRoute } from "@/server/auth/handlers";
import { putMenuPhoto, menuPhotoKey, type MemoryBlobStore } from "@/server/blob";
import { setDocDb, type DocDb } from "@/server/connectors/comms/docs";
import { D1Ledger } from "@/server/connectors/ledger-d1";
import { setLedger } from "@/server/connectors/ledger";
import type { ConnectorLedger } from "@/server/connectors/types";
import { createD1Repo } from "@/server/store/d1";
import { openTestD1 } from "@/server/store/d1-test-utils";
import { createD1DocDb } from "@/server/connectors/comms/docs";
import { createStore, putMenu } from "@/server/handlers/workspace";
import { setRepo, type Repo } from "@/server/store";
import { cardFor, cleanEdition } from "../e/helpers";
import { Jar, PASSWORD, call, signupBody, authRig } from "./helpers";
import type { D1Like } from "@/server/platform/types";

const rig = authRig();
const opened: { dispose: () => Promise<void> }[] = [];
afterAll(async () => { for (const o of opened) await o.dispose(); });

interface Backend { repo: Repo; ledger: ConnectorLedger; docs: DocDb; blobs: MemoryBlobStore; count?: (table: string, where: string, ...bind: unknown[]) => Promise<number> }

/** The memory rig, or the same stack over one D1 database (repo, accounts, connector tables, comms docs). */
async function backend(kind: "memory" | "d1"): Promise<Backend> {
  if (kind === "memory") return { repo: rig.repo, ledger: rig.ledger, docs: rig.docs, blobs: rig.blobs };
  const t = await openTestD1();
  opened.push(t);
  const db: D1Like = t.db;
  const repo = createD1Repo(async () => db);
  setRepo(repo);
  setAuthStore(new D1AuthStore(db));
  const ledger = new D1Ledger(db);
  setLedger(ledger);
  const docs = createD1DocDb(db);
  setDocDb(docs);
  return { repo, ledger, docs, blobs: rig.blobs, count: async (table, where, ...bind) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...bind).first<{ n: number }>())!.n };
}

async function seed(b: Backend, email: string, chainName: string) {
  const jar = new Jar();
  const { workspaceId, user } = await (await call(signupRoute, "/api/auth/signup", { body: signupBody({ email, chainName }), jar })).json();
  const store = await (await call(createStore, "/api/stores", { body: { name: `${chainName} Corner`, addressLabel: "Orchard St & Rivington St", lat: 40.7205, lon: -73.9893 }, jar })).json();
  await call(putMenu, "/api/menu", { method: "PUT", jar, body: [{ id: "menu_flat_white", name: "Flat white", category: "coffee", price: 4.5, currency: "USD", description: null, source: "manual", seen: true, priceLegible: true }] });
  const edition = { ...cleanEdition("store_williamsburg", `ed_${workspaceId}`), storeId: store.id };
  await b.repo.putEdition(edition);
  await b.repo.putStaffCard(cardFor(edition, `tok_${workspaceId}`));
  await b.repo.cachePut(`qloo:profile:v1:${store.id}:w1`, { profile: { evidenceIds: [] }, evidence: [] }, 600);
  await call(putOnboardingRoute, "/api/onboarding", { method: "PUT", jar, body: { skip: ["tools"] } });
  // Connector state: a Square connection with a sealed token, a sync event, calendar token, Slack install, a photo.
  await b.ledger.putConnection(workspaceId, "square", {
    connection: { provider: "square", status: "connected", mode: "sandbox", accountLabel: "Sandbox", connectedAt: new Date().toISOString(), lastSyncAt: null, error: null, capabilities: [] },
    merchantId: `M_${workspaceId}`, tokenEnc: "v1.aaaa.bbbb", refreshEnc: "v1.cccc.dddd", tokenExpiresAt: null, meta: {},
  });
  await b.ledger.addEvent(workspaceId, { id: `sync_${workspaceId}`, provider: "square", at: new Date().toISOString(), direction: "in", kind: "menu.imported", summary: "Imported", storeId: null, editionId: null, ok: true });
  const calendarToken = await b.ledger.getOrCreateCalendarToken(workspaceId, "chain", null, () => `cal_${workspaceId}`);
  await b.ledger.putOAuthState(`state_${workspaceId}`, workspaceId, "square", 600);
  await b.docs.put({ workspaceId, kind: "slack_install", key: "slack", ref: `T_${workspaceId}`, json: "{}", at: new Date().toISOString() });
  await putMenuPhoto(workspaceId, new Uint8Array([1, 2, 3]), "image/png", b.blobs);
  return { jar, workspaceId, userId: user.id as string, storeId: store.id as string, editionId: edition.id, calendarToken, email };
}

const alive = async (b: Backend, s: Awaited<ReturnType<typeof seed>>) => ({
  workspace: (await b.repo.getWorkspace(s.workspaceId)) !== null,
  store: (await b.repo.getStore(s.storeId)) !== null,
  edition: (await b.repo.getEdition(s.editionId)) !== null,
  card: (await b.repo.getStaffCardByEdition(s.editionId)) !== null,
  profileCache: (await b.repo.cacheGet(`qloo:profile:v1:${s.storeId}:w1`)) !== null,
  connection: (await b.ledger.getConnection(s.workspaceId, "square")) !== null,
  events: (await b.ledger.listEvents(s.workspaceId, null, 10)).length > 0,
  calendar: (await b.ledger.resolveCalendarToken(s.calendarToken)) !== null,
  slack: (await b.docs.list(s.workspaceId, "slack_install", 5)).length > 0,
  photo: (await b.blobs.get(menuPhotoKey(s.workspaceId, "image/png"))) !== null,
});
const EVERYTHING_GONE = { workspace: false, store: false, edition: false, card: false, profileCache: false, connection: false, events: false, calendar: false, slack: false, photo: false };
const EVERYTHING_THERE = Object.fromEntries(Object.keys(EVERYTHING_GONE).map((k) => [k, true]));

describe.each(["memory", "d1"] as const)("DELETE /api/account (%s)", (kind) => {
  it("deletes the user, sessions, workspace, connector tokens, photo and data, and nobody else's", async () => {
    const b = await backend(kind);
    const mine = await seed(b, "maya@kettleandkiln.example", "Kettle & Kiln");
    const other = await seed(b, "omar@birchcoffee.example", "Birch Coffee");
    expect(await alive(b, mine)).toEqual(EVERYTHING_THERE);

    const res = await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie().filter((c) => c.includes("Max-Age=0")).map((c) => c.split("=")[0]).sort()).toEqual(["le_sid", "le_ws"]);

    expect(await alive(b, mine)).toEqual(EVERYTHING_GONE);
    expect(await alive(b, other)).toEqual(EVERYTHING_THERE);
    expect(await b.ledger.consumeOAuthState(`state_${mine.workspaceId}`, "square")).toBeNull();
    expect(await b.ledger.consumeOAuthState(`state_${other.workspaceId}`, "square")).toBe(other.workspaceId);
    if (b.count) {
      for (const t of ["chains", "stores", "menus", "editions", "staff_cards", "connector_connections", "connector_events", "calendar_tokens", "comms_docs", "onboarding", "square_locations", "connector_oauth_state", "connector_deliveries", "build_runs", "build_events"]) {
        expect(await b.count(t, "workspace_id = ?", mine.workspaceId), t).toBe(0);
      }
      expect(await b.count("workspaces", "id = ?", mine.workspaceId)).toBe(0);
      for (const t of ["chains", "stores", "menus", "editions", "staff_cards", "connector_connections", "connector_events", "calendar_tokens", "comms_docs", "onboarding"]) {
        expect(await b.count(t, "workspace_id = ?", other.workspaceId), `${t} of the other account`).toBeGreaterThan(0);
      }
      expect(await b.count("users", "id = ?", mine.userId)).toBe(0);
      expect(await b.count("sessions", "user_id = ?", mine.userId)).toBe(0);
      expect(await b.count("users", "id = ?", other.userId)).toBe(1);
    }

    // The account is gone for good: its old cookie, its password and its address all lead nowhere.
    expect((await (await call(meRoute, "/api/auth/me", { jar: mine.jar })).json()).user).toBeNull();
    const again = await call(signinRoute, "/api/auth/signin", { body: { email: mine.email, password: PASSWORD } });
    expect(again.status).toBe(401);
    expect((await call(signupRoute, "/api/auth/signup", { body: signupBody({ email: mine.email, chainName: "Kettle & Kiln again" }) })).status).toBe(200); // the address is free again
  });

  it("asks for the password again: a wrong one deletes nothing and counts as a failed try", async () => {
    const b = await backend(kind);
    const mine = await seed(b, "maya@kettleandkiln.example", "Kettle & Kiln");
    const wrong = await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: { password: "not my password" } });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe("invalid_credentials");
    expect(await alive(b, mine)).toEqual(EVERYTHING_THERE);
    for (let i = 0; i < 5; i++) await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: { password: "still wrong" } });
    const locked = await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: { password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(await alive(b, mine)).toEqual(EVERYTHING_THERE);
  });

  it("needs a session, valid input and a same-site request", async () => {
    const b = await backend(kind);
    const mine = await seed(b, "maya@kettleandkiln.example", "Kettle & Kiln");
    const anon = await call(deleteAccountRoute, "/api/account", { method: "DELETE", body: { password: PASSWORD } });
    expect(anon.status).toBe(401);
    expect((await anon.json()).code).toBe("unauthenticated");
    expect((await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: {} })).status).toBe(400);
    expect((await call(deleteAccountRoute, "/api/account", { method: "DELETE", jar: mine.jar, body: { password: PASSWORD }, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(await alive(b, mine)).toEqual(EVERYTHING_THERE);
  });
});
