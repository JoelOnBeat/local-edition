import type { Edition } from "@/contract";

export type StoreWeekStatus = Edition["status"] | "none";

/** Map ring + label per status. The fill is always the store's own colour; the ring says where it stands. */
export const STATUS_META: Record<StoreWeekStatus, { label: string; ring: string; dashed: boolean }> = {
  approved: { label: "Approved", ring: "var(--ok)", dashed: false },
  flagged: { label: "Flagged", ring: "var(--flag)", dashed: false },
  draft: { label: "Draft", ring: "var(--muted)", dashed: true },
  drafting: { label: "Drafting", ring: "var(--info)", dashed: true },
  none: { label: "No edition", ring: "var(--rule)", dashed: true },
};

/** Flagged first, then drafts waiting on head office, then approved. */
export const STATUS_ORDER: Record<StoreWeekStatus, number> = { flagged: 0, drafting: 1, draft: 2, none: 3, approved: 4 };

export const countApproved = (e: Edition) => e.items.filter((i) => i.status === "approved" || i.status === "edited").length;
