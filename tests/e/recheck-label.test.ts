import { describe, expect, it } from "vitest";
import type { EditionItem } from "@/contract";
import { recheckItem } from "@/server/handlers/items";
import { cleanEdition } from "./helpers";

const special = () => cleanEdition("store_williamsburg", "ed_recheck").items.find((i) => i.kind === "special") as EditionItem;

describe("recheckItem keeps who checked the copy", () => {
  it("carries checkedBy and a pass-with-a-note through an edit", async () => {
    const note = "Skipped self check output: the model could not be reached.";
    const out = await recheckItem(special(), async () => ({ status: "passed", reasons: [note], checkedBy: "live" }), ["Plain."]);
    expect(out.guardrail).toEqual({ status: "passed", reasons: [note], checkedBy: "live" });
    expect(out.status).toBe("edited");
  });

  it("the worst field wins and keeps its own checkedBy and rail", async () => {
    let n = 0;
    const out = await recheckItem(special(), async () => (n++ === 0 ? { status: "passed", reasons: [], checkedBy: "live" } : { status: "blocked", rail: "check health claims", reasons: ["Health claim."], checkedBy: "live" }), ["Plain."]);
    expect(out.guardrail).toMatchObject({ status: "blocked", rail: "check health claims", checkedBy: "live" });
    expect(out.status).toBe("flagged");
  });

  it("an outage is unchecked and labelled live, never passed", async () => {
    const out = await recheckItem(special(), async () => { throw new Error("down"); }, ["Plain."]);
    expect(out.guardrail.status).toBe("unchecked");
    expect(out.guardrail.checkedBy).toBe("live");
  });
});
