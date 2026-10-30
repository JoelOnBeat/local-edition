import type { BlockProfile, Evidence } from "@/contract";
import type {
  ArtistCandidate,
  BrandCandidate,
  EventCandidate,
  PlaceCandidate,
  RisingCandidate,
} from "./ports";

/** A menu item matched to a block tag by embedding similarity. */
export interface MenuPair {
  ref: string;
  menuItemId: string;
  menuItemName: string;
  tagId: string;
  tagName: string;
  lift: number;
  score: number;
  evidenceId: string;
}

export interface PlaceEntry {
  ref: string;
  place: PlaceCandidate;
  rerankScore?: number;
  rerankEvidenceId?: string;
}

export interface ArtistEntry { ref: string; artist: ArtistCandidate }
export interface BrandEntry { ref: string; brand: BrandCandidate }
export interface RisingEntry { ref: string; item: RisingCandidate }
export interface EventEntry { ref: string; event: EventCandidate }

/**
 * Everything the tools have returned for one store. Model-visible handles (`p1`, `a3`, `e2`...) are
 * stable per run, so the model picks among candidates by handle and can never invent an entity or
 * an evidence id.
 */
export class ToolMemory {
  profile: BlockProfile | null = null;
  /** Tools that already ran successfully (the fallback plan skips them). */
  done = new Set<string>();
  /** Tools skipped because a model they need is unavailable: said once, not asked again by the fixed plan. */
  skipped = new Set<string>();
  pairs: MenuPair[] = [];
  places = new Map<string, PlaceEntry>();
  artists = new Map<string, ArtistEntry>();
  brands = new Map<string, BrandEntry>();
  rising = new Map<string, RisingEntry>();
  events = new Map<string, EventEntry>();
  private evidence = new Map<string, Evidence>();
  private refs = new Map<string, string>();

  addEvidence(items: Evidence[]): string[] {
    for (const e of items) if (!this.evidence.has(e.id)) this.evidence.set(e.id, e);
    return items.map((e) => e.id);
  }

  hasEvidence(id: string): boolean {
    return this.evidence.has(id);
  }

  allEvidence(): Evidence[] {
    return [...this.evidence.values()];
  }

  evidenceFor(ids: string[]): Evidence[] {
    return ids.flatMap((id) => (this.evidence.has(id) ? [this.evidence.get(id)!] : []));
  }

  /** Stable handle for an entity key within a prefix namespace. */
  private ref(prefix: string, key: string): string {
    const k = `${prefix}:${key}`;
    let r = this.refs.get(k);
    if (!r) {
      r = `${prefix}${[...this.refs.keys()].filter((x) => x.startsWith(`${prefix}:`)).length + 1}`;
      this.refs.set(k, r);
    }
    return r;
  }

  addPlaces(list: PlaceCandidate[]): PlaceEntry[] {
    return list.map((place) => {
      const ref = this.ref("p", place.entity.entityId);
      const prev = this.places.get(ref);
      const entry: PlaceEntry = { ...prev, ref, place };
      this.places.set(ref, entry);
      return entry;
    });
  }

  addArtists(list: ArtistCandidate[]): ArtistEntry[] {
    return list.map((artist) => {
      const ref = this.ref("a", artist.entity.entityId);
      const entry = { ref, artist };
      this.artists.set(ref, entry);
      return entry;
    });
  }

  addBrands(list: BrandCandidate[]): BrandEntry[] {
    return list.map((brand) => {
      const ref = this.ref("b", brand.entity.entityId);
      const entry = { ref, brand };
      this.brands.set(ref, entry);
      return entry;
    });
  }

  addRising(list: RisingCandidate[]): RisingEntry[] {
    return list.map((item) => {
      const ref = this.ref("r", `${item.kind}:${item.entity.entityId}`);
      const entry = { ref, item };
      this.rising.set(ref, entry);
      return entry;
    });
  }

  addEvents(list: EventCandidate[]): EventEntry[] {
    return list.map((event) => {
      const ref = this.ref("e", `${event.url}|${event.startsAt ?? ""}`);
      const entry = { ref, event };
      this.events.set(ref, entry);
      return entry;
    });
  }

  setPairs(pairs: Omit<MenuPair, "ref">[]): MenuPair[] {
    this.pairs = pairs.map((p, i) => ({ ...p, ref: `s${i + 1}` }));
    return this.pairs;
  }
}
