import type { CheckCopy } from "./ports";
import { getOverrides } from "./ports";

/** Connects stream D's guardrails to edit re-checks. Only the item PATCH route imports this file. */
const realCheck: CheckCopy = async (input) => {
  const guardrails = await import("../guardrails");
  const { result, text } = await guardrails.checkCopyDetailed(input);
  return { ...result, text };
};

export async function getCheckCopy(): Promise<CheckCopy> {
  return getOverrides().checkCopy ?? realCheck;
}


