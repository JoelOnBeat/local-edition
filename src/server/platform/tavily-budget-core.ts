import type { StorageLike } from "./storage";
import type { TavilyBudgetStub, TavilyReserveResult, TavilyUsage } from "./stubs";

interface State {
  /** Credits spent since the counter began (the hard total). */
  total: number;
  /** The UTC day `dayUsed` belongs to. */
  day: string;
  dayUsed: number;
}

const KEY = "tavily-credits";
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The GLOBAL Tavily credit ledger, logic only (TavilyBudgetDO wraps it). One free Tavily key is shared, so Local Edition gets a hard total (80 credits through 15 Dec) and a daily slice (6), counted across
 * every workspace and every isolate. The Durable Object runs one request at a time, so "check both caps, then
 * take the credits" is one atomic step, which Workers KV could not give. The caps are arguments so a config
 * change needs no migration; a reservation is refused whole, never part-spent.
 */
export class TavilyBudgetCore implements TavilyBudgetStub {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StorageLike, private readonly now: () => number = Date.now) {}

  /** The object's own gates already serialise callers; this queue makes the core correct on any storage. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<State> {
    const saved = await this.storage.get<State>(KEY);
    const today = dayOf(this.now());
    const state: State = saved && Number.isFinite(saved.total) ? { ...saved } : { total: 0, day: today, dayUsed: 0 };
    if (state.day !== today) {
      state.day = today;
      state.dayUsed = 0;
    }
    return state;
  }

  reserve(credits: number, totalCap: number, dailyCap: number): Promise<TavilyReserveResult> {
    return this.exclusive(async () => {
      const state = await this.load();
      const usage = { total: state.total, today: state.dayUsed };
      if (state.total + credits > totalCap) return { ok: false as const, reason: "total" as const, ...usage };
      if (state.dayUsed + credits > dailyCap) return { ok: false as const, reason: "daily" as const, ...usage };
      state.total += credits;
      state.dayUsed += credits;
      await this.storage.put(KEY, state);
      return { ok: true as const, day: state.day, total: state.total, today: state.dayUsed };
    });
  }

  /** Gives credits back for a call that failed before Tavily billed it. `day` is the ticket's day: a refund never touches another day's slice. */
  refund(credits: number, day: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      state.total = Math.max(0, state.total - credits);
      if (state.day === day) state.dayUsed = Math.max(0, state.dayUsed - credits);
      await this.storage.put(KEY, state);
    });
  }

  usage(): Promise<TavilyUsage> {
    return this.exclusive(async () => {
      const state = await this.load();
      return { total: state.total, today: state.dayUsed, day: state.day };
    });
  }
}
