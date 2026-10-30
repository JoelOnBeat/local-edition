import { z } from "zod";
import { fetchJson } from "../http/fetch-json";
import { createLogger } from "../log";

const log = createLogger("tf:catalog");

/** The model list is read at most this often, and a model that answered 404 is not asked again for as long. */
export const CATALOG_TTL_MS = 10 * 60_000;

const ModelList = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

/**
 * What Token Factory serves right now, from a cached `GET /v1/models` (refreshed at most every ten minutes) plus the models that
 * just answered 404. It only ever says "gone" when it KNOWS: a list that cannot be read (network, 5xx, bad key, empty) counts as
 * "unknown", and unknown means the call goes ahead.
 */
export interface ModelCatalog {
  /** False when the model is missing from the list or answered 404 within the last ten minutes. */
  available(model: string): Promise<boolean>;
  /** A call to this model just answered 404 / model_not_found: do not ask again until the ten minutes pass. */
  markGone(model: string): void;
}

export function createModelCatalog(o: { list: () => Promise<string[] | null>; now?: () => number }): ModelCatalog {
  const now = o.now ?? Date.now;
  let ids: Set<string> | null = null;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | null = null;
  const gone = new Map<string, number>();

  const refresh = (): Promise<void> => {
    inflight ??= (async () => {
      try {
        const list = await o.list();
        ids = list && list.length ? new Set(list.map((m) => m.toLowerCase())) : null;
      } catch {
        ids = null;
      } finally {
        fetchedAt = now();
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    async available(model) {
      if ((gone.get(model) ?? 0) > now()) return false;
      if (now() - fetchedAt >= CATALOG_TTL_MS) await refresh();
      else if (inflight) await inflight;
      return ids === null || ids.has(model.toLowerCase());
    },
    markGone(model) {
      gone.set(model, now() + CATALOG_TTL_MS);
      log.warn("model answered 404; skipping its calls for ten minutes", { model });
    },
  };
}

/** `GET {base}models` with the key. `null` for any failure: the catalog then says nothing and calls go ahead. Never recorded, never metered. */
export function tokenFactoryModelList(o: { baseUrl: string; apiKey?: string; fetchImpl?: typeof fetch }): () => Promise<string[] | null> {
  return async () => {
    try {
      const r = await fetchJson({
        provider: "tokenfactory",
        method: "GET",
        url: `${o.baseUrl}models`,
        headers: o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {},
        mode: "live",
        schema: ModelList,
        timeoutMs: 10_000,
        retries: 1,
        record: false,
        fetchImpl: o.fetchImpl,
      });
      return r.data.data.map((m) => m.id);
    } catch (e) {
      log.warn("could not read the model list; calls go ahead", { err: (e as Error).name });
      return null;
    }
  };
}
