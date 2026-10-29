import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { NebiusError } from "./errors";
import type { TokenProvider } from "./jobs";

/**
 * The Nebius CLI as a developer's session uses it: the `hackathon-jobs-sa` profile, nothing else. The profile file
 * (~/.nebius) is never read here and no command that shows a profile is ever run.
 */
const run = promisify(execFile);
export const NEBIUS_CLI = `${homedir()}/.local/bin/nebius`;
export const NEBIUS_PROFILE = "hackathon-jobs-sa";

type Exec = (file: string, args: string[], opts: { maxBuffer: number; timeout: number }) => Promise<{ stdout: string; stderr?: string }>;

/**
 * A token provider backed by `nebius --profile hackathon-jobs-sa iam get-access-token`, run in-process with execFile (no shell).
 * The token is held in memory only: never printed, logged or written to disk, and CLI stderr is never echoed.
 */
export function cliTokenProvider(exec: Exec = run as Exec): TokenProvider {
  let cached: string | null = null;
  return {
    async getToken(opts) {
      if (cached && !opts?.forceRefresh) return cached;
      try {
        const { stdout } = await exec(NEBIUS_CLI, ["--profile", NEBIUS_PROFILE, "iam", "get-access-token"], { maxBuffer: 64 * 1024, timeout: 30_000 });
        const token = stdout.trim();
        if (token.length < 20 || /\s/.test(token)) throw new Error("unexpected output");
        cached = token;
        return token;
      } catch {
        throw new NebiusError("nebius_auth", `\`nebius --profile ${NEBIUS_PROFILE} iam get-access-token\` failed; check that the CLI is installed and the profile is signed in.`);
      }
    },
  };
}

/** The job's output, read with the CLI (`nebius ai job logs <id>`); null when it cannot be read (a job that never started has none). */
export async function readJobLogs(jobId: string, exec: Exec = run as Exec): Promise<string | null> {
  try {
    const { stdout } = await exec(NEBIUS_CLI, ["--profile", NEBIUS_PROFILE, "ai", "job", "logs", jobId], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    return stdout;
  } catch {
    return null;
  }
}
