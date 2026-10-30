import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/contract";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import { BuildWorkflowParams } from "../../workflows/types";
import { runEditionBuild } from "../../workflows/edition-build";
import { FakeStep, freshLog, params as workflowParams, scriptedPorts, okStore } from "../../workflows/test-utils";
import { makeHarness, slackOk, type Harness } from "../comms/test-utils";
import { buttonValue } from "./blocks";
import { postDigest } from "./digest";
import { handleInteraction, type SlackInteraction } from "./interactions";
import { runRegenerateJob } from "./regenerate";

const regenerateMock = vi.fn();
vi.mock("../../agent/regenerate", () => ({ regenerateItem: (...args: unknown[]) => regenerateMock(...args) }));
const create = vi.fn();
const flags = { workflow: true };
vi.mock("../../workflows/mode", () => ({ useWorkflow: () => flags.workflow }));
vi.mock("../../platform/env", async (orig) => ({ ...(await orig<typeof import("../../platform/env")>()), platformEnvSync: () => ({ EDITION_BUILD: { create } }) }));

const TEAM = "T0SAMPLE1";
let h: Harness;
beforeEach(async () => {
  create.mockReset();
  regenerateMock.mockReset();
  flags.workflow = true;
  h = await makeHarness({ env: { COMPOSIO_SAMPLE_GMAIL_ACCOUNT: undefined } });
  slackOk(h.net);
  await postDigest(h.deps, h.workspace.id);
});

const click = (editionId: string): SlackInteraction => ({
  type: "block_actions", user: { id: "U0HANNAH" }, team: { id: TEAM },
  container: { message_ts: "1761436500.000200", channel_id: "C0HEADOFFICE" },
  actions: [{ action_id: SLACK_ACTIONS.regenerate, value: buttonValue(h.workspace.id, editionId) }],
});
const updates = () => h.net.to("chat.update").map((c) => c.body);

describe("Slack Regenerate on the EditionBuild Workflow", () => {
  it("starts a Workflow instance instead of running the rewrite inside waitUntil, and the message says it is regenerating", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(edition.id));
    expect(create).toHaveBeenCalledTimes(1);
    expect(regenerateMock).not.toHaveBeenCalled();
    const { id, params } = create.mock.calls[0][0] as { id: string; params: unknown };
    const parsed = BuildWorkflowParams.parse(params);
    expect(id).toBe(parsed.runId);
    expect(parsed.workspaceId).toBe(h.workspace.id);
    expect(parsed.regenerate).toMatchObject({ editionId: edition.id, userId: "U0HANNAH" });
    expect(edition.items.find((i) => i.id === parsed.regenerate!.itemId)?.kind).toBe("special");
    expect(updates().some((u) => u.includes("asked for a new special"))).toBe(true);
    // A second click on the same take is ignored.
    await handleInteraction(h.deps, click(edition.id));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("runs inline when the Workflow is not bound (next dev) or refuses to start", async () => {
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { /* done */ });
    flags.workflow = false;
    await handleInteraction(h.deps, click(h.editions[0].id));
    expect(create).not.toHaveBeenCalled();
    expect(regenerateMock).toHaveBeenCalledTimes(1);
    flags.workflow = true;
    create.mockRejectedValueOnce(new Error("workflow quota"));
    await handleInteraction(h.deps, click(h.editions[1].id));
    expect(regenerateMock).toHaveBeenCalledTimes(2);
  });

  it("the Workflow step does the rewrite, updates the message, and a failure frees the click for another try", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(edition.id));
    const job = BuildWorkflowParams.parse((create.mock.calls[0][0] as { params: unknown }).params).regenerate!;
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { yield { type: "error", code: "spend_cap", message: "The spend cap was reached." }; });
    await runRegenerateJob(h.deps, h.workspace.id, job);
    expect(updates().at(-1)).toContain("The spend cap was reached.");
    expect(await h.store.claim(job.claimKey)).toBe(true); // released: the claim can be taken again
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { /* ok */ });
    await runRegenerateJob(h.deps, h.workspace.id, job);
    expect(updates().at(-1)).toContain("A new special is ready for review");
  });

  it("runEditionBuild with a regenerate job runs one step and touches no run log", async () => {
    const log = await freshLog();
    try {
      const seen: string[] = [];
      const ports = { ...scriptedPorts(log.runLog, ["a"], okStore), regenerate: async (ws: string, j: { itemId: string }) => { seen.push(`${ws}:${j.itemId}`); } };
      const step = new FakeStep();
      const job = { editionId: "ed1", itemId: "it1", userId: "U1", atUnix: 1, claimKey: "k" };
      const out = await runEditionBuild(step, ports, workflowParams({ regenerate: job }));
      expect(out.status).toBe("done");
      expect(seen).toEqual(["ws_t:it1"]);
      expect(step.order).toEqual(["regenerate"]);
      expect(await log.runLog.get("run_t1")).toBeNull();
      const failing = { ...ports, regenerate: async () => { throw new Error("boom"); } };
      expect((await runEditionBuild(new FakeStep(), failing, workflowParams({ regenerate: job }))).status).toBe("failed");
    } finally {
      await log.dispose();
    }
  });
});
