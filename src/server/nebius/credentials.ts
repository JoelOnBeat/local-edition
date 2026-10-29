import { z } from "zod";
import { NebiusError } from "./errors";

/**
 * The service-account credentials file written by `nebius iam ...` and uploaded with
 * `wrangler secret put NEBIUS_SA_CREDENTIALS < ~/.nebius/hackathon-jobs-sa.json`:
 *
 *   { "subject-credentials": { "type", "alg", "private-key", "kid", "iss", "sub" } }
 *
 * (key names verified against the real file; values never read by this code at build time).
 * `kid` is the authorized-key (public key) id; `iss` and `sub` are the service account id.
 */
const fileSchema = z.object({
  "subject-credentials": z.object({
    type: z.string().min(1).optional(),
    alg: z.literal("RS256"),
    "private-key": z.string().min(64),
    kid: z.string().min(1),
    iss: z.string().min(1),
    sub: z.string().min(1),
  }),
});

export interface NebiusCredentials {
  /** Authorized key id: the JWT `kid` header. */
  keyId: string;
  /** Service account id: the JWT `iss` claim. */
  issuer: string;
  /** Service account id: the JWT `sub` claim. */
  subject: string;
  /** PEM private key, PKCS#8 (`BEGIN PRIVATE KEY`) or PKCS#1 (`BEGIN RSA PRIVATE KEY`). */
  privateKeyPem: string;
}

/**
 * Parses the `NEBIUS_SA_CREDENTIALS` secret. Errors name the missing or invalid FIELD only,
 * never a value, so a failure is safe to log.
 */
export function parseCredentials(raw: string | undefined | null): NebiusCredentials {
  if (!raw || !raw.trim()) {
    throw new NebiusError("nebius_auth", "NEBIUS_SA_CREDENTIALS is not set. Run: wrangler secret put NEBIUS_SA_CREDENTIALS < ~/.nebius/hackathon-jobs-sa.json");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new NebiusError("nebius_auth", "NEBIUS_SA_CREDENTIALS is not valid JSON.");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))].slice(0, 6).join(", ");
    throw new NebiusError("nebius_auth", `NEBIUS_SA_CREDENTIALS has missing or invalid fields: ${fields}.`);
  }
  const c = parsed.data["subject-credentials"];
  return { keyId: c.kid, issuer: c.iss, subject: c.sub, privateKeyPem: c["private-key"] };
}
