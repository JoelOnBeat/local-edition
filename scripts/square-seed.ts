/**
 * Seeds the Square sandbox with the sample chain: 5 categories, 20 menu items from the sample menu and 8 locations at the sample stores'
 * New York addresses. Idempotent: it finds what exists by name and only creates or updates what differs. Run twice, get the same account.
 *
 *   npx tsx scripts/square-seed.ts            # seeds
 *   npx tsx scripts/square-seed.ts --dry-run  # prints the plan, changes nothing
 *
 * Token: LOCALEDITION_SQUARE_ACCESS_TOKEN from the secret store (never printed). Sandbox responses are recorded to .recordings/square/ (gitignored).
 */
import { sandboxClient } from "./square/lib";
import { seedSandbox } from "./square/seed";

sandboxClient()
  .then((client) => seedSandbox(client, { dry: process.argv.includes("--dry-run"), say: (s) => process.stdout.write(`${s}\n`) }))
  .catch((e) => {
    process.stderr.write(`square-seed failed: ${(e as Error).message}\n`);
    process.exit(1);
  });
