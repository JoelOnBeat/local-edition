import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "@/contract";
import { patchItem } from "@/server/handlers/editions";
import { getWorkspace } from "@/server/handlers/workspace";
import type { Repo } from "@/server/store";
import { cleanEdition, cookieOf, fakePorts, freshApp, json, req } from "../e/helpers";

const item = vi.fn();
vi.mock("@/server/connectors/square/dispatch", () => ({
  dispatchSquare: async () => undefined,
  dispatchSquareItem: (...args: unknown[]) => { item(...args); return Promise.resolve(); },
}));

let repo: Repo;
let cookie: string;
let workspaceId: string;
let edition: Edition;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  item.mockReset();
  repo = freshApp({}, fakePorts());
  const ws = await getWorkspace(req("/api/workspace", { ip: "10.4.4.4" }));
  cookie = cookieOf(ws);
  const body = await ws.json();
  workspaceId = body.workspace.id;
  edition = { ...cleanEdition(), id: "ed_sq", storeId: body.stores[0].id };
  await repo.putEdition(edition);
});

const act = async (itemId: string, action: "approve" | "reject") => {
  const version = (await repo.getEdition(edition.id))!.items.find((i) => i.id === itemId)!.version;
  return patchItem(req("/x", { cookie, ...json({ action }, { method: "PATCH", headers: { "if-match": String(version) } }) }), params({ id: edition.id, itemId }));
};

describe("approving a special publishes it to Square at once", () => {
  it("calls the per-item publisher for a special, with the workspace, edition and item", async () => {
    const special = edition.items.find((i) => i.kind === "special")!;
    expect((await act(special.id, "approve")).status).toBe(200);
    await settle();
    expect(item).toHaveBeenCalledWith(workspaceId, "ed_sq", special.id);
  });

  it("does not publish for other kinds, for a reject, or for an item that is already approved", async () => {
    const sound = edition.items.find((i) => i.kind === "sound")!;
    await act(sound.id, "approve");
    const special = edition.items.find((i) => i.kind === "special")!;
    await act(special.id, "reject");
    await settle();
    expect(item).not.toHaveBeenCalled();
  });

  it("a Square failure never fails the approval", async () => {
    item.mockImplementationOnce(() => { throw new Error("square down"); });
    const special = edition.items.find((i) => i.kind === "special")!;
    expect((await act(special.id, "approve")).status).toBe(200);
    expect((await repo.getEdition(edition.id))!.items.find((i) => i.id === special.id)!.status).toBe("approved");
  });
});
