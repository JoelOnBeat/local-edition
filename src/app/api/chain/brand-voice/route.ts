import { ipLimited } from "@/server/limits";
import { brandVoicePost } from "@/server/tavily/brand-voice-handler";

export const POST = ipLimited({ name: "brand-voice", capacity: 6, refillPerMinute: 3 }, brandVoicePost);
