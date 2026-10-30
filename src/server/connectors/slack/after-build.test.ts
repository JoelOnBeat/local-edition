import { describe, expect, it } from "vitest";
import { makeHarness, slackOk } from "../comms/test-utils";
import { postDigestAfterBuild } from "./after-build";

const NO_MAIL = { COMPOSIO_SAMPLE_GMAIL_ACCOUNT: undefined };

describe("digest after a build", () => {
  it("posts the digest for the finished editions when Slack is connected, once", async () => {
    const h = await makeHarness({ env: NO_MAIL });
    slackOk(h.net);
    const ids = h.editions.map((e) => e.id);
    await postDigestAfterBuild(h.workspace.id, ids, h.deps);
    await postDigestAfterBuild(h.workspace.id, ids, h.deps);
    expect(h.net.to("chat.postMessage")).toHaveLength(1);
  });

  it("does nothing, and does not throw, when Slack is not connected or nothing was built", async () => {
    const h = await makeHarness({ sample: false, env: NO_MAIL });
    await expect(postDigestAfterBuild(h.workspace.id, h.editions.map((e) => e.id), h.deps)).resolves.toBeUndefined();
    await expect(postDigestAfterBuild(h.workspace.id, [], h.deps)).resolves.toBeUndefined();
    expect(h.net.calls).toHaveLength(0);
  });

  it("swallows a Slack failure", async () => {
    const h = await makeHarness({ env: NO_MAIL }); // no scripted network: every call answers 500
    await expect(postDigestAfterBuild(h.workspace.id, h.editions.map((e) => e.id), h.deps)).resolves.toBeUndefined();
  });
});
