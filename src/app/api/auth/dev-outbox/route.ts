import { apiError } from "@/server/http/api";
import { takeOutbox } from "@/server/auth/code-sender";
import { Email } from "@/contract";

export const dynamic = "force-dynamic";

/** Development and tests only (CODE_SENDER=log): hands back the newest code kept for an address. A 404 in production, always. */
export function GET(request: Request): Response {
  if (process.env.NODE_ENV === "production") return apiError(404, "not_found", "Not found.");
  const email = Email.safeParse(new URL(request.url).searchParams.get("email") ?? "");
  const code = email.success ? takeOutbox(email.data) : undefined;
  return code ? Response.json({ code }, { headers: { "cache-control": "no-store" } }) : apiError(404, "not_found", "No code waiting for that address.");
}
