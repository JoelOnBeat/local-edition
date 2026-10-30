import { BRAND_VOICE_LIMITS } from "@/server/limits-table";
import { ipLimited } from "@/server/limits";
import { brandVoicePost } from "@/server/tavily/brand-voice-handler";

export const POST = ipLimited({ name: "brand-voice", ...BRAND_VOICE_LIMITS.ip }, brandVoicePost);
