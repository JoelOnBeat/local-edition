import { beforeEach } from "vitest";
import { MemoryRecorder, setRecorder } from "@/server/http/recorder";
import { setRepo } from "@/server/store";
import { createMemoryRepo } from "@/server/store/memory";

/**
 * Runs before every test file. Tests never touch the disk or a previous run's data:
 * - STORE_DRIVER defaults to memory (a test that wants the file or kv driver builds its own repo);
 * - every test starts with a fresh MemoryRecorder, so a live smoke run's `.recordings/` can never be replayed
 *   by `npm test`, and a fresh memory repo, so rate-limit buckets and the spend ledger never leak across tests.
 */
process.env.STORE_DRIVER ??= "memory";
// Tests written before sessions existed call the handlers with no session. Real sessions are required everywhere else (src/server/session.ts);
// tests/auth/ turns this off to test exactly that.
process.env.LE_ALLOW_ANONYMOUS ??= "1";

beforeEach(() => {
  setRecorder(new MemoryRecorder());
  setRepo(createMemoryRepo());
});
