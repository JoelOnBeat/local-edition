/** What the landing page shows from the canonical demo workspace. Read-only, built at request time, never committed. */

export interface LandingTag {
  name: string;
  affinity: number;
  lift: number;
}

export interface LandingStoreRow {
  id: string;
  name: string;
  address: string;
  colorIndex: number;
  /** `none`: no edition built from live Qloo answers yet. */
  status: "approved" | "draft" | "flagged" | "none";
  special: string;
  approved: number;
  total: number;
  /** The block's strongest tag against the city, from a live Qloo answer; null when it could not be read. */
  topTag: LandingTag | null;
}

export interface LandingFeatured {
  name: string;
  address: string;
  colorIndex: number;
  tags: LandingTag[];
  special: { name: string; description: string; flavourTags: string[] } | null;
  sound: { mood: string; brief: string; artists: string[] } | null;
  partner: { name: string; reason: string; offerIdea: string; distanceM: number } | null;
  event: { title: string; when: string; description: string } | null;
}

export interface LandingGuardrail {
  store: string;
  before: string;
  after: string;
  rail: string;
  reason: string;
}

export interface LandingSample {
  /** ISO Monday of the editions shown. */
  weekOf: string;
  /** When this view was read from the workspace. */
  readAt: string;
  rows: LandingStoreRow[];
  featured: LandingFeatured | null;
  guardrail: LandingGuardrail | null;
}
