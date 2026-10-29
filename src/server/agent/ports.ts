import type {
  BlockProfile,
  Chain,
  DataMode,
  Evidence,
  GuardrailResult,
  MenuItem,
  QlooEntityRef,
  Store,
} from "@/contract";
import type { Repo } from "../store/repo";

/**
 * Everything the edition agent needs from other streams, as narrow ports. `deps.ts` is the only
 * file that imports the real Qloo / Tavily / Token Factory / Guardrails modules, so tests inject
 * fakes here and a signature change in another stream touches one adapter.
 */

export const AGENT_MODEL = "nvidia/Nemotron-3.5-Super-VL";
export const COPY_MODEL = "nvidia/Nemotron-3_5-Lightning";
export const FALLBACK_AGENT_LABEL = "deterministic-plan";

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

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolSpec[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ChatToolCall[];
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

export interface QlooPort {
  blockProfile(store: Store, chain: Chain): Promise<{ profile: BlockProfile; evidence: Evidence[] }>;
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
  embed(texts: string[]): Promise<{ vectors: number[][]; mode: DataMode }>;
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
  /** Tool and model deadlines; tests shrink them. */
  limits?: Partial<AgentLimits>;
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
