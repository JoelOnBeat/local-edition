// Copies MapLibre's self-contained worker from node_modules into public/, so the map loads it from our own origin (no CDN).
// Runs before `next dev` and `next build` (predev / prebuild); the copy is also committed, so a build that skips npm hooks still has it.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const to = join(root, "public", "vendor", "maplibre-gl-worker.mjs");
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
const version = JSON.parse(readFileSync(join(root, "node_modules", "maplibre-gl", "package.json"), "utf8")).version;
process.stdout.write(`vendored maplibre-gl@${version} worker to public/vendor/maplibre-gl-worker.mjs\n`);
