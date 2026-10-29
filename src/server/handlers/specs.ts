import { z } from "zod";
import { ItemAction, routes } from "@/contract";

/**
 * Request schemas for the decisions made after the data-path review (docs/CONTRACT.md). They extend the
 * contract's own schemas, so anything the contract already requires still applies; a field added here
 * is simply read from the body instead of being stripped.
 */

const [approve, reject, edit] = ItemAction.options;

/** `override: true` lets head office approve copy that guardrails could not check (never blocked copy). */
export const PatchItemBody = z.discriminatedUnion("action", [approve.extend({ override: z.boolean().optional() }), reject, edit]);

export const patchItemSpec = {
  ...routes.patchItem,
  request: z.object({ params: routes.patchItem.request.shape.params, body: PatchItemBody }),
} as const;

/** `force: true` rebuilds a store even when its current edition has approved or edited items. */
export const BuildBody = routes.buildEditions.request.shape.body.extend({ force: z.boolean().optional() });

export const buildSpec = {
  ...routes.buildEditions,
  request: z.object({ body: BuildBody }),
} as const;
