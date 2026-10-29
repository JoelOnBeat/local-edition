import { normalizeCopy } from "./catalogue";

/**
 * Prompt-injection phrases in web-derived text (Tavily snippets). TypeScript mirror of
 * guardrails/localedition/injection.py; a vitest test compares ids and patterns and runs both over
 * guardrails/tests/injection.json. The live path blocks on a hit; the Nebius job strips the sentence.
 */

export interface InjectionRule {
  id: string;
  pattern: string;
  reason: string;
}

export const INJECTION_RULES: InjectionRule[] = [
  {
    id: "ignore_instructions",
    pattern: String.raw`\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,30}\b(?:previous|prior|above|earlier|preceding|all|any|your|the|these)\b[^.!?\n]{0,30}\b(?:instructions?|prompts?|rules?|guidelines?|directions?|context|constraints?)\b`,
    reason: "Prompt injection: text tells the reader or a model to ignore its instructions.",
  },
  {
    id: "role_override",
    pattern: String.raw`\b(?:you are now|from now on,? you|act as|pretend (?:to be|you are)|behave as)\b[^.!?\n]{0,40}\b(?:assistant|ai|model|chatbot|bot|dan|system|admin|developer|jailbroken|unrestricted)\b`,
    reason: "Prompt injection: text tries to give a model a new role.",
  },
  {
    id: "system_prompt",
    pattern: String.raw`\b(?:system prompt|developer (?:message|prompt)|hidden (?:prompt|instructions?)|reveal (?:your|the) (?:instructions?|prompt|rules))\b`,
    reason: "Prompt injection: text refers to a model's system prompt or hidden instructions.",
  },
  {
    id: "chat_markers",
    pattern: String.raw`(?:<\|(?:im_start|im_end|system|user|assistant)\|>|\[/?inst\]|<</?sys>>|^\s*(?:system|assistant|developer)\s*:|###\s*(?:system|instruction|new instructions?))`,
    reason: "Prompt injection: text contains chat-template markers.",
  },
  {
    id: "new_instructions",
    pattern: String.raw`\b(?:new|updated|real|actual|additional) (?:instructions?|task|orders?|directive)s?\s*:`,
    reason: "Prompt injection: text announces new instructions.",
  },
  {
    id: "conceal",
    pattern: String.raw`\b(?:do not|don't|never) (?:tell|mention|reveal|show|inform) (?:the )?(?:user|reader|customer|operator|human)\b`,
    reason: "Prompt injection: text asks to hide something from the user.",
  },
  {
    id: "tool_exfil",
    pattern: String.raw`\b(?:send|post|forward|leak|exfiltrate|email) (?:this|the|your|all)\b[^.!?\n]{0,30}\b(?:conversation|api key|keys?|secrets?|credentials|tokens?|system prompt|chat history)\b`,
    reason: "Prompt injection: text asks to send out secrets or the conversation.",
  },
];

const COMPILED = INJECTION_RULES.map((rule) => ({ rule, rx: new RegExp(rule.pattern, "im") }));

export interface InjectionHit {
  rule: InjectionRule;
  match: string;
}

/** First match of every rule that fires, in rule order. */
export function findInjection(text: string | null | undefined): InjectionHit[] {
  const value = normalizeCopy(text);
  const hits: InjectionHit[] = [];
  for (const { rule, rx } of COMPILED) {
    const m = rx.exec(value);
    if (m) hits.push({ rule, match: m[0].trim() });
  }
  return hits;
}
