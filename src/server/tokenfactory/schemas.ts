import { z } from "zod";

/** Response shapes we rely on. Loose: extra provider fields are kept, never required. */

const Usage = z.looseObject({
  prompt_tokens: z.number().nonnegative().optional(),
  completion_tokens: z.number().nonnegative().optional(),
  total_tokens: z.number().nonnegative().optional(),
  completion_tokens_details: z.looseObject({ reasoning_tokens: z.number().nonnegative().nullish() }).nullish(),
});

export const ToolCall = z.looseObject({
  id: z.string().min(1),
  type: z.literal("function").default("function"),
  function: z.looseObject({ name: z.string().min(1), arguments: z.string() }),
});

export const ChatCompletion = z.looseObject({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.looseObject({
        index: z.number().optional(),
        finish_reason: z.string().nullable().optional(),
        message: z.looseObject({
          role: z.string().optional(),
          content: z.string().nullable().optional(),
          tool_calls: z.array(ToolCall).nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: Usage.nullable().optional(),
});
export type ChatCompletion = z.infer<typeof ChatCompletion>;

export const EmbeddingsResponse = z.looseObject({
  model: z.string().optional(),
  data: z.array(z.looseObject({ index: z.number().int().nonnegative(), embedding: z.array(z.number()).min(1) })),
  usage: Usage.nullable().optional(),
});
export type EmbeddingsResponse = z.infer<typeof EmbeddingsResponse>;

export const RerankResponse = z.looseObject({
  model: z.string().optional(),
  results: z.array(z.looseObject({ index: z.number().int().nonnegative(), relevance_score: z.number() })),
  usage: Usage.nullable().optional(),
});
export type RerankResponse = z.infer<typeof RerankResponse>;
