# Local Edition: shared contract (source of truth for UI and backend)

Owner: architecture. Implemented in zod at `src/contract/`. Every stream builds against
these types; the UI's mock data is generated from them. Change only via the architect.

## Product in one line
For each store of a chain, a weekly "edition" (special, sound brief, local partner, event night)
built from that block's taste (Qloo), with evidence per item, approved by head office, plus a
one-page staff card. Rebuilt every Monday.

## Domain types (zod, `src/contract/domain.ts`)
- `QlooEntityRef` { entityId: string, name: string, type: string /* urn:entity:… */ }
- `Chain` { id, name, category: 'coffee'|'restaurant'|'gym'|'hotel', brandVoice: string[] (1-3,
  each <= 140 chars), anchors: QlooEntityRef[] (1-3 brands the chain resembles),
  city: { name, lat, lon }, isSample: boolean }
- `Store` { id, chainId, name /* neighbourhood */, addressLabel /* "Bedford Ave & N 7th St" */,
  lat, lon, colorIndex: 1..8 }
- `MenuItem` { id, name, category: 'coffee'|'tea'|'bakery'|'food'|'cold'|'other',
  price: number|null, currency: 'USD', description: string|null, source: 'vl'|'manual' }
- `Evidence` { id, source: 'qloo'|'tavily'|'tokenfactory', endpoint: string /* path only */,
  params: Record<string,string> /* never a key */, summary: string,
  metrics: { affinity?: number, popularity?: number, lift?: number, distanceM?: number,
  relevance?: number }, entityIds: string[], url?: string, fetchedAt: ISO string,
  mode: 'live'|'replay'|'fixture'|'cache' }
- `BlockTag` { tagId, name, kind: 'cuisine'|'flavour'|'ambience'|'music'|'activity'|'other',
  affinity: number, lift: number /* store affinity minus city baseline */ }
- `BlockProfile` { storeId, tags: BlockTag[] (<= 12, by lift desc), evidenceIds: string[], computedAt }
- `GuardrailResult` { status: 'passed'|'rewritten'|'blocked'|'unchecked', rail?: string,
  reasons: string[], original?: string }
- `EditionItem` = common { id, status: 'draft'|'flagged'|'approved'|'edited'|'rejected',
  evidenceIds: string[] (>= 1, else the item is dropped), guardrail: GuardrailResult,
  version: number } plus one of:
  - `special` { baseMenuItemId, name, description, flavourTags: string[], staffLine }
  - `sound` { brief /* 1-2 sentences */, mood, artists: QlooEntityRef[] (8-15) }
  - `partner` { place: QlooEntityRef & { address: string|null, lat, lon, distanceM },
    reason, offerIdea }
  - `event` { title, day: 'Mon'..'Sun', time /* "19:00" */, description,
    tieIn: { title, url, source: 'tavily' } | null }
- `Edition` { id, storeId, weekOf /* ISO date, a Monday */, issueNo, items: EditionItem[],
  evidence: Evidence[], status: 'drafting'|'draft'|'flagged'|'approved',
  generatedBy: { agentModel, copyModel, runId }, createdAt }
- `StaffCard` { editionId, storeId, token /* share link id */, lines: { heading, body }[],
  guardrail: GuardrailResult }
- `CompareResult` { a: storeId, b: storeId, shared: BlockTag[], onlyA: BlockTag[], onlyB: BlockTag[],
  evidenceIds: string[] }
- `JobRun` { id, trigger: 'cron'|'manual', startedAt, finishedAt: string|null,
  storeIds: string[], status: 'running'|'done'|'failed', nebiusJobId: string|null, note }
- `ProviderStatus` { qloo: Mode, tokenfactory: Mode, tavily: Mode, guardrails: 'up'|'down'|'local',
  spend: { usd: number, capUsd: number } } where Mode = 'live'|'replay'|'fixture'|'cache'|'missing-key'
- `Workspace` { id, chainId, createdAt } — one per visitor (httpOnly cookie `le_ws`), seeded with a
  copy of the sample chain, so judges never collide.

## Streaming events (`src/contract/events.ts`, Server-Sent Events, `data: <json>\n\n`)
`AgentEvent` discriminated on `type`:
`run_started` {runId, storeIds} · `store_started` {storeId} ·
`tool_call` {storeId, tool, args} · `tool_result` {storeId, tool, ok, summary, evidenceIds} ·
`item_drafted` {storeId, item} · `guardrail` {storeId, itemId, result} ·
`store_done` {storeId, editionId} · `run_done` {runId, editionIds} · `error` {storeId?, code, message}

## API routes (`src/contract/routes.ts`: method, path, request schema, response schema)
All inputs validated with zod. Errors: `{ error: string, code?: string }` with a proper status;
never a raw stack or upstream body.
| Method + path | Request | Response | Stream |
|---|---|---|---|
| GET /api/workspace | — | { workspace, chain, stores, menu, latestEditions } | E |
| PUT /api/chain | Chain fields (name, brandVoice, anchors) | Chain | E |
| POST /api/stores/import | text/csv (name,address,lat,lon) | Store[] | E |
| POST /api/stores | { name, addressLabel, lat, lon } | Store | E |
| DELETE /api/stores/:id | — | { ok } | E |
| POST /api/menu/read | multipart `image` (<= 5 MB jpg/png/webp) | MenuItem[] | A |
| PUT /api/menu | MenuItem[] | MenuItem[] | E |
| GET /api/anchors/search?q= | — | QlooEntityRef[] (brands) | B |
| GET /api/stores/:id/profile | — | { profile, evidence } | B |
| GET /api/compare?a=&b= | — | { result, evidence } | B |
| POST /api/editions/build | { storeIds?: string[] } | SSE AgentEvent | C |
| POST /api/editions/:id/items/:itemId/regenerate | { hint?: string } | SSE AgentEvent | C |
| GET /api/editions?weekOf= | — | Edition[] | E |
| GET /api/editions/:id | — | Edition | E |
| PATCH /api/editions/:id/items/:itemId | { action: 'approve'|'reject'|'edit', patch? } | EditionItem (edit re-runs guardrails) | E |
| POST /api/editions/:id/approve-all | — | Edition | E |
| GET /api/editions/:id/card | — | StaffCard (generated on first request) | C |
| GET /api/card/:token | — | StaffCard + store + chain name (public) | E |
| POST /api/jobs/monday | header `x-le-signature` HMAC-SHA256 of body | JobRun | E |
| GET /api/jobs/latest | — | JobRun | null | E |
| GET /api/status | — | ProviderStatus | E |

## Modes
- `DATA_MODE=mock`: the UI's typed client returns `src/mocks/` data (generated from the contract,
  realistic, 8 NYC stores); no server calls. For UI work before the backend is wired.
- `DATA_MODE=app` (default): real routes. Each provider picks its own mode:
  `QLOO_MODE`, `TF_MODE`, `TAVILY_MODE` = `live` | `replay` | `fixture` (default `replay`,
  falling back to `fixture` when no recording exists). Live needs the key; a missing key reports
  `missing-key` in /api/status and the provider falls back to replay/fixture.
- Recordings live in `.recordings/` (gitignored: Qloo data must never reach the public repo).
  Synthetic fixtures in `fixtures/` are committed and badged "Sample data" in the UI.

## Guarantees every stream keeps
- Every edition item carries >= 1 evidence id; an item without evidence is dropped, never shown.
- All copy (special, event, card) passes guardrails before status `draft`; if guardrails is down
  the item is `unchecked` and can never be auto-approved.
- No health, diet, nutrition or allergen claims anywhere. No identity targeting. Taste only.
- No customer or personal data ever goes to Qloo: only coordinates, entity ids, tag urns.
- Spend cap: `SPEND_CAP_USD` (default 5) enforced in the Token Factory client; beyond it, calls
  fail with code `spend_cap` and the UI says so.
