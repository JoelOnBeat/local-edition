import { describe, expect, it } from "vitest";
import { authenticate } from "@/server/jobs/job-auth";
import { deriveJobSecret, signRequest } from "@/server/jobs/hmac";
import { freshApp, req } from "../../tests/e/helpers";
import { cliTokenProvider, NEBIUS_CLI } from "./cli";
import { buildRunnerJob, DEFAULT_APP_URL, parseArgs, redact, summarize, UsageError } from "./runner";

// Throwaway values, generated for this file only.
const SHARED = "runner-test-shared-secret-0123456789abcdef";
const API_KEY = "runner-test-tf-key-zyxwvutsrqponmlkjihgfedcba";
const NOW = new Date("2026-11-02T00:07:00Z");
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const secretFile = (files: Array<{ containerPath: string; content: string }>, name: string) => files.find((f) => f.containerPath === `/opt/le-secrets/${name}`);

describe("parseArgs", () => {
  it("takes one or more modes, defaults to the judge URL and is not a dry run", () => {
    expect(parseArgs(["certify", "eval"])).toEqual({ modes: ["certify", "eval"], appUrl: DEFAULT_APP_URL, csvUrl: undefined, dryRun: false });
    expect(parseArgs(["eval", "--dry-run"]).dryRun).toBe(true);
  });

  it("requires an https origin for --app-url and refuses credentials or a path", () => {
    expect(parseArgs(["certify", "--app-url", "https://preview.example.org/"]).appUrl).toBe("https://preview.example.org");
    for (const bad of ["http://localhost:3000", "ftp://x.org", "https://user:pw@x.org", "https://x.org/app", "not a url"]) {
      expect(() => parseArgs(["certify", "--app-url", bad]), bad).toThrow(UsageError);
    }
  });

  it("refuses no mode, an unknown mode or option, a repeated mode, and a csv url without import (or import without one)", () => {
    for (const argv of [[], ["bogus"], ["certify", "--nope"], ["certify", "certify"], ["certify", "--csv-url", "https://x.org/a.csv"], ["import"], ["import", "--csv-url", "http://x.org/a.csv"]]) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(UsageError);
    }
    expect(parseArgs(["import", "--csv-url", "https://x.org/a.csv"]).csvUrl).toBe("https://x.org/a.csv");
  });
});

describe("buildRunnerJob", () => {
  it("never puts LE_JOB_SECRET, the per-job secret or NEBIUS_API_KEY in environmentVariables (only in /opt/le-secrets files)", async () => {
    const { request, name } = await buildRunnerJob(parseArgs(["certify", "eval"]), { LE_JOB_SECRET: SHARED, NEBIUS_API_KEY: API_KEY }, NOW);
    const derived = await deriveJobSecret(SHARED, name);
    const envVars = request.spec.environmentVariables ?? [];
    expect(envVars.map((e) => e.name)).not.toContain("LE_JOB_SECRET");
    expect(envVars.map((e) => e.name)).not.toContain("NEBIUS_API_KEY");
    for (const v of [SHARED, API_KEY, derived]) expect(JSON.stringify(envVars)).not.toContain(v);
    expect(envVars).toEqual(expect.arrayContaining([{ name: "TRIGGER", value: "manual" }, { name: "JOB_NAME", value: name }, { name: "APP_URL", value: DEFAULT_APP_URL }]));
    // Plain-text request JSON never carries the shared secret or the derived one (injected files are base64).
    expect(JSON.stringify(request)).not.toContain(SHARED);
    expect(JSON.stringify(request)).not.toContain(derived);
    const files = request.spec.injectedFiles ?? [];
    expect(decode(secretFile(files, "NEBIUS_API_KEY")!.content)).toBe(API_KEY);
    expect(decode(secretFile(files, "LE_JOB_SECRET")!.content)).toBe(derived);
    expect(decode(secretFile(files, "LE_JOB_SECRET")!.content)).not.toBe(SHARED);
  });

  it("names the job local-edition-<modes>-<timestamp>, runs the modes in order, and keeps import free of the model key", async () => {
    const both = await buildRunnerJob(parseArgs(["certify", "eval"]), { LE_JOB_SECRET: SHARED, NEBIUS_API_KEY: API_KEY }, NOW);
    expect(both.name).toBe("local-edition-certify-eval-202611020007");
    expect(both.request.spec.args).toBe("/opt/le/run.sh certify eval");
    const imp = await buildRunnerJob(parseArgs(["import", "--csv-url", "https://x.org/stores.csv?sig=abc"]), { LE_JOB_SECRET: SHARED }, NOW);
    expect(imp.request.spec.environmentVariables).toEqual(expect.arrayContaining([{ name: "IMPORT_CSV_URL", value: "https://x.org/stores.csv?sig=abc" }]));
    expect(secretFile(imp.request.spec.injectedFiles ?? [], "NEBIUS_API_KEY")).toBeUndefined();
  });

  it("the per-job secret verifies with the app's own verifier, for this job and no other", async () => {
    freshApp({ LE_JOB_SECRET: SHARED });
    const built = await buildRunnerJob(parseArgs(["certify", "eval"]), { LE_JOB_SECRET: SHARED, NEBIUS_API_KEY: API_KEY }, new Date());
    const jobSecret = decode(secretFile(built.request.spec.injectedFiles ?? [], "LE_JOB_SECRET")!.content);
    const send = async (secret: string, jobId: string, path = "/api/jobs/results") => {
      const raw = JSON.stringify({ ts: Math.floor(Date.now() / 1000), results: [] });
      const request = req(path, { method: "POST", headers: { "x-le-job-id": jobId, "x-le-signature": await signRequest(secret, { method: "POST", path, jobId }, raw) }, body: raw });
      return authenticate({ request, bytes: new TextEncoder().encode(raw) }).then(() => "ok", (e: { code?: string }) => e.code);
    };
    expect(await send(jobSecret, built.name)).toBe("ok");
    expect(await send(jobSecret, "local-edition-certify-eval-209901010000")).toBe("bad_signature"); // another job's name
    expect(await send(jobSecret, built.name, "/api/jobs/monday")).toBe("bad_signature"); // an endpoint that starts a build needs the shared secret
  });

  it("refuses a missing or short LE_JOB_SECRET, and a missing model key for certify or eval", async () => {
    await expect(buildRunnerJob(parseArgs(["certify"]), { NEBIUS_API_KEY: API_KEY }, NOW)).rejects.toThrow(UsageError);
    await expect(buildRunnerJob(parseArgs(["certify"]), { LE_JOB_SECRET: "short", NEBIUS_API_KEY: API_KEY }, NOW)).rejects.toThrow(UsageError);
    await expect(buildRunnerJob(parseArgs(["eval"]), { LE_JOB_SECRET: SHARED }, NOW)).rejects.toThrow(/NEBIUS_API_KEY/);
  });

  it("the dry-run summary names secret files but shows no secret value", async () => {
    const { request, name } = await buildRunnerJob(parseArgs(["certify", "eval"]), { LE_JOB_SECRET: SHARED, NEBIUS_API_KEY: API_KEY }, NOW);
    const text = summarize(request).join("\n");
    expect(text).toContain(name);
    expect(text).toMatch(/secret files hold: .*LE_JOB_SECRET.*NEBIUS_API_KEY.* \(values not shown\)/);
    for (const v of [SHARED, API_KEY, await deriveJobSecret(SHARED, name)]) expect(text).not.toContain(v);
  });
});

describe("cliTokenProvider", () => {
  const TOKEN = "v1.CLITOKEN.abcdefghijklmnopqrstuvwxyz0123456789";

  it("runs the hackathon-jobs-sa profile's get-access-token with execFile and caches it in memory", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const tokens = cliTokenProvider(async (file, args) => { calls.push({ file, args }); return { stdout: `${TOKEN}\n` }; });
    expect(await tokens.getToken()).toBe(TOKEN);
    expect(await tokens.getToken()).toBe(TOKEN);
    expect(calls).toEqual([{ file: NEBIUS_CLI, args: ["--profile", "hackathon-jobs-sa", "iam", "get-access-token"] }]);
    await tokens.getToken({ forceRefresh: true });
    expect(calls).toHaveLength(2);
  });

  it("never echoes the CLI's own error output", async () => {
    const tokens = cliTokenProvider(async () => { throw Object.assign(new Error(`failed: ${TOKEN}`), { stderr: TOKEN }); });
    const failure = await tokens.getToken().catch((e: Error) => e);
    expect(failure).toMatchObject({ code: "nebius_auth" });
    expect((failure as Error).message).not.toContain(TOKEN);
  });
});

describe("redact", () => {
  it("removes every secret value from text that came back from a job", () => {
    expect(redact(`key=${API_KEY} and ${SHARED}`, [API_KEY, SHARED, undefined])).toBe("key=[redacted] and [redacted]");
  });
});
