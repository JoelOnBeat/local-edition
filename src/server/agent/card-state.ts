import type { Repo } from "../store/repo";

/**
 * Blank an existing staff card's lines when its edition changes. The share token stays valid and
 * `getOrCreateCard` rewrites the lines on the next request.
 */
export async function invalidateCard(repo: Repo, editionId: string): Promise<void> {
  const card = await repo.getStaffCardByEdition(editionId);
  if (card && card.lines.length) {
    await repo.putStaffCard({ ...card, lines: [], guardrail: { status: "unchecked", reasons: ["The edition changed; the card will be rewritten."] } });
  }
}
