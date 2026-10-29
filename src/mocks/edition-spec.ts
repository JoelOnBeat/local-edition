import type { GuardrailResult, ItemStatus, Weekday } from "@/contract";

export interface ItemState {
  status?: ItemStatus;
  guardrail?: GuardrailResult;
}

export interface StoreEditionSpec {
  special: ItemState & {
    baseMenuSlug: string;
    name: string;
    description: string;
    flavourTags: string[];
    staffLine: string;
  };
  sound: ItemState & { brief: string; mood: string; artists: string[] };
  partner: ItemState & {
    name: string;
    address: string;
    /** Offset from the store, in degrees. */
    dLat: number;
    dLon: number;
    reason: string;
    offerIdea: string;
  };
  event: ItemState & {
    title: string;
    day: Weekday;
    time: string;
    description: string;
    tieIn: { title: string; url: string } | null;
  };
}
