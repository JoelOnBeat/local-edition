import type {
  BlockProfile,
  Chain,
  DataMode,
  ModelRole,
  Evidence,
  GuardrailResult,
  MenuItem,
  QlooEntityRef,
  Store,
} from "@/contract";
import type { Repo } from "../store/repo";
import type { StepSink } from "./metrics";

/**
 * Everything the edition agent needs from other streams, as narrow ports. `deps.ts` is the only
 * file that imports the real Qloo / Tavily / Token Factory / Guardrails modules, so tests inject
 * fakes here and a signature change in another stream touches one adapter.
 */

export const AGENT_MODEL = "nvidia/Nemotron-3.5-Super-VL";
export const COPY_MODEL = "nvidia/Nemotron-3_5-Lightning";
export const FALLBACK_AGENT_LABEL = "deterministic-plan";
/** Head office reviewer (cross-store pass). Falls back to the agent model with an honest `reviewedBy`. */
export const REVIEW_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b";
export const REVIEW_FALLBACK_MODEL = AGENT_MODEL;

// ---- Chat (OpenAI-compatible, Token Factory) -------------------------------------------------

export interface ChatToolCall {
  id: string;
  name: string;
  /** Raw JSON text from the model; always validated by the caller. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ChatToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

/** Provider thinking control (see tokenfactory/reasoning.ts): `off` for copy and JSON, `default` for the tool loop. */
export type Reasoning = "off" | "low" | "default";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolSpec[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  reasoning?: Reasoning;
  /** Strict structured output: the provider is asked for JSON matching this schema. */
  responseFormat?: { name: string; schema: Record<string, unknown> };
  /** Which job this call does, for `step_metrics`. Defaults from the model id (Lightning is copy, Ultra is review). */
  role?: ModelRole;
  /** Names the call in `step_metrics` when it has no tool calls of its own (for example `write_copy`). */
  tag?: string;
}

export interface ChatUsage {
  promptTokens: number;
  /** Prompt tokens served from the provider's implicit prefix cache. */
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ChatToolCall[];
  /** The provider's usage. When absent, `step_metrics` falls back to a characters-per-token estimate. */
  usage?: ChatUsage;
}

export interface ChatClient {
  complete(req: ChatRequest): Promise<ChatResponse>;
}

// ---- Candidates returned by the data ports ----------------------------------------------------

export interface WithEvidence<T> {
  items: T;
  evidence: Evidence[];
}

export interface PlaceCandidate {
  entity: QlooEntityRef;
  address: string | null;
  lat: number;
  lon: number;
  distanceM: number;
  affinity?: number;
  tags: string[];
  evidenceIds: string[];
}

export interface ArtistCandidate {
  entity: QlooEntityRef;
  affinity?: number;
  genres?: string[];
  evidenceIds: string[];
}

export interface BrandCandidate {
  entity: QlooEntityRef;
  affinity?: number;
  evidenceIds: string[];
}

export type RisingKind = "place" | "artist" | "brand";

export interface RisingCandidate {
  entity: QlooEntityRef;
  kind: RisingKind;
  /** Places gained in rank under bias.trends=high, when known. */
  rankDelta?: number;
  evidenceIds: string[];
}

export interface EventCandidate {
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD) or date-time; null when the listing carries no date. */
  startsAt: string | null;
  venue?: string | null;
  snippet?: string | null;
  evidenceIds: string[];
}

/** One tag of the cached city baseline. `group` is the tag namespace urn of the list it came from (its lowest affinity is the floor for tags the list lacks). */
export interface BaselineTag {
  tagId: string;
  affinity: number;
  group: string;
}

export interface QlooPort {
  blockProfile(store: Store, chain: Chain): Promise<{ profile: BlockProfile; evidence: Evidence[] }>;
  /**
   * The cached city baseline the block profile's lifts were measured against (tag id and affinity), or null
   * when none is cached. The evidence verifier recomputes lift from it.
   */
  baseline?(chain: Chain): Promise<BaselineTag[] | null>;
  placesNear(store: Store, chain: Chain, opts: { tagIds?: string[]; limit?: number }): Promise<WithEvidence<PlaceCandidate[]>>;
  artistsLocal(store: Store, chain: Chain, opts: { genres?: string[]; limit?: number }): Promise<WithEvidence<ArtistCandidate[]>>;
  brandsLocal(store: Store, chain: Chain, opts: { limit?: number }): Promise<WithEvidence<BrandCandidate[]>>;
  rising(store: Store, chain: Chain, opts: { kind: RisingKind }): Promise<WithEvidence<RisingCandidate[]>>;
}

export interface TavilyPort {
  eventsThisWeek(store: Store, chain: Chain, weekOf: string): Promise<WithEvidence<EventCandidate[]>>;
}

export interface RankedDoc {
  index: number;
  score: number;
}

export interface TokenFactoryPort {
  embed(texts: string[]): Promise<{ vectors: number[][]; mode: DataMode; usage?: { promptTokens: number } }>;
  /** Reranker first, embedding cosine when the reranker is unavailable. */
  rerank(query: string, docs: string[]): Promise<{ ranked: RankedDoc[]; method: "rerank" | "embedding"; mode: DataMode }>;
}

export type CopyKind = "special" | "sound" | "partner" | "event" | "card";

export interface GuardrailsPort {
  /**
   * Throws or returns status `unchecked` when the guardrails service is down. When status is
   * `rewritten`, `text` is the revised copy.
   */
  checkCopy(input: { text: string; kind: CopyKind; brandVoice: string[] }): Promise<GuardrailResult & { text?: string }>;
}

export interface AgentDeps {
  repo: Repo;
  chat: ChatClient;
  qloo: QlooPort;
  tavily: TavilyPort;
  tf: TokenFactoryPort;
  guardrails: GuardrailsPort;
  now(): Date;
  /** What this store's managers told head office in recent weeks (lane B3, from reply emails). Optional; untrusted text, used as data only. */
  storeSignals?: (storeId: string) => Promise<{ category: string; summary: string }[]>;
  /** Tool and model deadlines; tests shrink them. */
  limits?: Partial<AgentLimits>;
  /** Collects `step_metrics` for every model call; set by `withMetrics` at the entry points. */
  sink?: StepSink;
  /** Inject one clearly labelled bad item into the evidence verifier (fixture mode only; see verify.ts). */
  seedBadItem?: boolean;
}

export interface AgentLimits {
  maxSteps: number;
  maxInvalidCalls: number;
  chatTimeoutMs: number;
  toolTimeoutMs: number;
  loopDeadlineMs: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxSteps: 10,
  maxInvalidCalls: 3,
  chatTimeoutMs: 45_000,
  toolTimeoutMs: 25_000,
  loopDeadlineMs: 150_000,
};

export function limitsOf(deps: AgentDeps): AgentLimits {
  return { ...DEFAULT_LIMITS, ...deps.limits };
}

/** What the agent knows about a store for one run. */
export interface StoreContext {
  chain: Chain;
  store: Store;
  menu: MenuItem[];
  weekOf: string;
}
