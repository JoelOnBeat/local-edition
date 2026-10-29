import { getProof } from "@/server/handlers/proof";
import { ipLimited } from "@/server/limits";

export const dynamic = "force-dynamic";
export const GET = ipLimited({ name: "proof", capacity: 60, refillPerMinute: 60 }, getProof);
