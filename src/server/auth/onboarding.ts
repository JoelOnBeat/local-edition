import { SKIPPABLE_STEPS, type OnboardingState, type OnboardingUpdate } from "@/contract";
import { computeOnboarding, EMPTY_ONBOARDING, TITLES, type OnboardingFacts, type OnboardingMemory } from "@/lib/onboarding";
import { HttpError } from "../http/errors";
import type { Repo } from "../store";
import { getAuthStore, type AuthStore } from "./index";

export interface OnboardingDeps {
  repo: Repo;
  auth?: AuthStore;
  /** Connected providers among slack, gmail, outlook and calendar. A lane that cannot be read counts as none. */
  connectedTools: (workspaceId: string) => Promise<string[]>;
  now?: () => number;
}

async function gather(deps: OnboardingDeps, workspace: { id: string; chainId: string }): Promise<OnboardingFacts> {
  const chain = (await deps.repo.getChain(workspace.chainId))!;
  const stores = await deps.repo.listStores(chain.id);
  const editions = await deps.repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  return {
    chain,
    menuItems: (await deps.repo.listMenu(chain.id)).length,
    stores: stores.length,
    builtStores: editions.length,
    tools: await deps.connectedTools(workspace.id).catch(() => []),
  };
}

/** Remembers whether every step reads done or skipped, so `/api/auth/me` can answer "finished?" without recomputing it. */
async function syncCompletion(auth: AuthStore, workspaceId: string, doc: OnboardingMemory | null, state: OnboardingState, now: number): Promise<OnboardingState> {
  const was = Boolean(doc?.completedAt);
  if (state.complete === was && (doc || !state.complete)) return state;
  await auth.putOnboarding(workspaceId, { ...(doc ?? EMPTY_ONBOARDING), completedAt: state.complete ? now : null });
  return state;
}

export async function getOnboarding(deps: OnboardingDeps, workspace: { id: string; chainId: string }): Promise<OnboardingState> {
  const auth = deps.auth ?? (await getAuthStore());
  const doc = await auth.getOnboarding(workspace.id);
  return syncCompletion(auth, workspace.id, doc, computeOnboarding(await gather(deps, workspace), doc), (deps.now ?? Date.now)());
}

export async function updateOnboarding(deps: OnboardingDeps, workspace: { id: string; chainId: string }, input: OnboardingUpdate): Promise<OnboardingState> {
  const auth = deps.auth ?? (await getAuthStore());
  const doc = { ...EMPTY_ONBOARDING, ...(await auth.getOnboarding(workspace.id)) };
  for (const step of input.skip ?? []) {
    if (!SKIPPABLE_STEPS.includes(step)) throw new HttpError(400, "not_skippable", `${TITLES[step]} is needed before the first edition and cannot be skipped.`);
  }
  if (input.basics) {
    const chain = (await deps.repo.getChain(workspace.chainId))!;
    const { name, category, city } = input.basics;
    await deps.repo.putChain({
      ...chain,
      name: name ?? chain.name,
      category: category ?? chain.category,
      city: city ?? chain.city,
      // Renaming a sample chain makes it the owner's own (the same rule as PUT /api/chain).
      isSample: chain.isSample && (name === undefined || name === chain.name),
    });
    doc.basicsConfirmed = true;
  }
  const unskip = new Set(input.unskip ?? []);
  doc.skipped = [...new Set([...doc.skipped, ...(input.skip ?? [])])].filter((s) => !unskip.has(s));
  if (input.current) doc.current = input.current;
  doc.updatedAt = (deps.now ?? Date.now)();
  const state = computeOnboarding(await gather(deps, workspace), doc);
  doc.completedAt = state.complete ? (doc.completedAt ?? doc.updatedAt) : null;
  await auth.putOnboarding(workspace.id, doc);
  return state;
}
