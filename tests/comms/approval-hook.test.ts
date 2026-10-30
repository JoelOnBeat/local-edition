import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "@/contract";
import { dispatchApproved, registerDispatcher } from "@/server/connectors/dispatch";
import { approveAll, patchItem } from "@/server/handlers/editions";
import { getWorkspace } from "@/server/handlers/workspace";
import type { Repo } from "@/server/store";
import { cleanEdition, cookieOf, fakePorts, freshApp, json, req } from "../e/helpers";

/** The post-approval dispatcher fires exactly when an edition becomes approved, from either approval path. */

const seen = vi.fn();
let repo: Repo;
let cookie: string;
let workspaceId: string;
let edition: Edition;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  seen.mockReset();
  registerDispatcher("test-probe", async (a) => { seen(a); });
  repo = freshApp({}, fakePorts());
  const ws = await getWorkspace(req("/api/workspace", { ip: "10.3.3.3" }));
  cookie = cookieOf(ws);
  const body = await ws.json();
  workspaceId = body.workspace.id;
  edition = { ...cleanEdition(), id: "ed_hook", storeId: body.stores[0].id };
  await repo.putEdition(edition);
});

const approve = () => approveAll(req("/x", { cookie, method: "POST" }), params({ id: edition.id }));
const patchApprove = async (itemId: string) => {
  const version = (await repo.getEdition(edition.id))!.items.find((i) => i.id === itemId)!.version;
  return patchItem(req("/x", { cookie, ...json({ action: "approve" }, { method: "PATCH", headers: { "if-match": String(version) } }) }), params({ id: edition.id, itemId }));
};

describe("post-approval dispatch", () => {
  it("fires once when approve-all completes the edition, and not again for a repeat", async () => {
    await approve();
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ workspaceId, editionId: "ed_hook" });
    await approve();
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("fires when the last item is approved by hand, not before", async () => {
    const [a, b, c, d] = edition.items;
    for (const i of [a, b, c]) await patchApprove(i.id);
    await settle();
    expect(seen).not.toHaveBeenCalled();
    await patchApprove(d.id);
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("does not fire when something is still waiting for review", async () => {
    const [a] = edition.items;
    await repo.updateEditionItem(edition.id, { ...a, guardrail: { status: "unchecked", reasons: ["down"] } }, 0);
    await approve();
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps going when one dispatcher throws", async () => {
    registerDispatcher("test-broken", async () => { throw new Error("boom"); });
    const results = await dispatchApproved({ workspaceId, editionId: "ed_hook" });
    expect(results.find((r) => r.name === "test-broken")?.ok).toBe(false);
    expect(results.find((r) => r.name === "test-probe")?.ok).toBe(true);
  });
});
