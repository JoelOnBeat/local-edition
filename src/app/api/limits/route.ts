import { getLimits } from "@/server/handlers/limits";
import { ipLimited } from "@/server/limits";

export const dynamic = "force-dynamic";
export const GET = ipLimited({ name: "limits", capacity: 60, refillPerMinute: 60 }, getLimits);
