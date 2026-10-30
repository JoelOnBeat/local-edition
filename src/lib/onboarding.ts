import { ONBOARDING_STEPS, SKIPPABLE_STEPS, type Chain, type OnboardingState, type OnboardingStep, type OnboardingStepId } from "@/contract";

/**
 * Onboarding progress, the pure part (shared by the server and the mock backend). Whether a step is done is read from the workspace
 * itself (menu has items, a store exists, ...), so it can never disagree with the data and an owner who adds a store from another
 * screen sees the step turn done. What data cannot say is remembered in an `OnboardingMemory`: which optional steps were skipped,
 * that the chain basics were confirmed, and which step the owner was on.
 */

export interface OnboardingMemory {
  skipped: OnboardingStepId[];
  /** The owner has looked at the chain basics (name, category, city) and saved them. */
  basicsConfirmed: boolean;
  current: OnboardingStepId | null;
  updatedAt: number;
  /** When every step last read done or skipped; null (or absent) while some step is open. `/api/auth/me` reads this instead of recomputing. */
  completedAt?: number | null;
}

export const TITLES: Record<OnboardingStepId, string> = {
  basics: "Chain basics",
  menu: "Menu",
  stores: "Stores",
  voice: "Brand voice",
  anchors: "Taste anchors",
  tools: "Optional tools",
  build: "Build the first editions",
};

const OPTIONAL = new Set<OnboardingStepId>(["tools", "voice"]);
const NEEDED_FOR_BUILD: OnboardingStepId[] = ["menu", "stores", "anchors"];

export interface OnboardingFacts {
  chain: Chain;
  menuItems: number;
  stores: number;
  /** Stores with a finished (not `drafting`) edition. */
  builtStores: number;
  /** Providers among slack, gmail, outlook, calendar that are connected. */
  tools: string[];
}

export const EMPTY_ONBOARDING: OnboardingMemory = { skipped: [], basicsConfirmed: false, current: null, updatedAt: 0 };

/** Pure: facts + remembered choices -> the state the screens render. */
export function computeOnboarding(facts: OnboardingFacts, doc: OnboardingMemory | null): OnboardingState {
  const saved = doc ?? EMPTY_ONBOARDING;
  const done: Record<OnboardingStepId, boolean> = {
    basics: saved.basicsConfirmed && facts.chain.name.trim().length > 0,
    menu: facts.menuItems > 0,
    stores: facts.stores > 0,
    voice: facts.chain.brandVoice.length > 0,
    anchors: facts.chain.anchors.length > 0,
    tools: facts.tools.length > 0,
    build: facts.builtStores > 0,
  };
  const missing: Record<OnboardingStepId, string[]> = {
    basics: done.basics ? [] : ["Confirm your chain's name, category and city."],
    menu: done.menu ? [] : ["Connect Square, or upload a photo of your menu board."],
    stores: done.stores ? [] : ["Add at least one store: import a CSV, take them from Square, or add one by hand."],
    voice: done.voice ? [] : ["Write one to three lines about how your chain sounds."],
    anchors: done.anchors ? [] : ["Pick one to three brands your chain feels like."],
    tools: done.tools ? [] : ["Connect Slack, Gmail or Outlook, or add the calendar feed (optional)."],
    build: done.build ? [] : ["Build the first editions."],
  };
  const skipped = new Set(saved.skipped.filter((s) => SKIPPABLE_STEPS.includes(s)));

  const steps: OnboardingStep[] = ONBOARDING_STEPS.map((id) => {
    const status = done[id] ? "done" : skipped.has(id) ? "skipped" : "todo";
    const blockedBy = id === "build" && status === "todo" ? NEEDED_FOR_BUILD.filter((s) => !done[s]) : [];
    return {
      id,
      title: TITLES[id],
      optional: OPTIONAL.has(id),
      status,
      missing: status === "todo" ? missing[id] : [],
      blockedBy,
    };
  });
  const open = steps.filter((s) => s.status === "todo");
  const pointer = saved.current && open.some((s) => s.id === saved.current) ? saved.current : null;
  return {
    steps,
    current: pointer ?? open[0]?.id ?? null,
    complete: open.length === 0,
    updatedAt: saved.updatedAt ? new Date(saved.updatedAt).toISOString() : null,
  };
}

