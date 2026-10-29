import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { buildLocalEditionJob, localEditionJobName, MAX_INJECTED_FILE_BYTES, MAX_INJECTED_TOTAL_BYTES, RUN_SH, timestamp } from "./job-spec";

const bundle = {
  "certify.py": "#!/usr/bin/env python3\nprint('certify')\n",
  "le_http.py": "# helper\n",
  "requirements.txt": "nemoguardrails==0.24.1\n",
  "rails/config.yml": "models: []\n",
};
const base = { modes: ["certify"] as const, appUrl: "https://localedition.pages.dev/", jobSecret: "j".repeat(40), bundle, now: new Date("2026-11-02T00:07:00Z") };
const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe("buildLocalEditionJob", () => {
  it("names the job local-edition-<mode>-<yyyymmddhhmm> in UTC under the CPU project", () => {
    const { name, request } = buildLocalEditionJob(base);
    expect(name).toBe("local-edition-certify-202611020007");
    expect(request.metadata).toMatchObject({ name, parentId: "project-e04yk83jbc00bwhyv60mbp" });
    expect(timestamp(new Date("2026-01-05T03:04:59Z"))).toBe("202601050304");
  });

  it("uses the stock image, cpu-d3 2vcpu-8gb, a 20 GiB disk, a 3600s timeout and no volumes or bucket", () => {
    const { spec } = buildLocalEditionJob(base).request;
    expect(spec).toMatchObject({ image: "python:3.12-slim", platform: "cpu-d3", preset: "2vcpu-8gb", timeout: "3600s", restartAttempts: "0" });
    expect(spec.disk).toEqual({ type: "NETWORK_SSD", sizeBytes: String(20 * 1024 ** 3) });
    expect(spec).not.toHaveProperty("volumes");
    expect(spec).not.toHaveProperty("preemptible");
    expect(spec).not.toHaveProperty("registryCredentials");
  });

  it("runs run.sh with the modes in order, inside one job", () => {
    const { name, request } = buildLocalEditionJob({ ...base, modes: ["certify", "eval"] });
    expect(name).toBe("local-edition-certify-eval-202611020007");
    expect(request.spec).toMatchObject({ containerCommand: "bash", args: "/opt/le/run.sh certify eval", workingDir: "/opt/le" });
  });

  it("injects run.sh and every bundle file at /opt/le as base64 of the exact text", () => {
    const files = buildLocalEditionJob(base).request.spec.injectedFiles ?? [];
    const byPath = Object.fromEntries(files.map((f) => [f.containerPath, decode(f.content)]));
    expect(byPath["/opt/le/run.sh"]).toBe(RUN_SH);
    expect(byPath["/opt/le/certify.py"]).toBe(bundle["certify.py"]);
    expect(byPath["/opt/le/rails/config.yml"]).toBe(bundle["rails/config.yml"]);
    expect(byPath["/opt/le/requirements.txt"]).toBe("nemoguardrails==0.24.1\n");
  });

  it("sets APP_URL (trailing slash trimmed), TRIGGER and JOB_NAME as plain env", () => {
    const { name, request } = buildLocalEditionJob(base);
    const env = Object.fromEntries((request.spec.environmentVariables ?? []).map((e) => [e.name, e.value]));
    expect(env).toMatchObject({ APP_URL: "https://localedition.pages.dev", TRIGGER: "manual", JOB_NAME: name });
  });

  it("delivers secrets as injected files by default, never as env, and exports them in run.sh", () => {
    const { request } = buildLocalEditionJob({ ...base, secrets: { NEBIUS_API_KEY: "k".repeat(30) } });
    const files = Object.fromEntries((request.spec.injectedFiles ?? []).map((f) => [f.containerPath, decode(f.content)]));
    expect(files["/opt/le-secrets/LE_JOB_SECRET"]).toBe("j".repeat(40));
    expect(files["/opt/le-secrets/NEBIUS_API_KEY"]).toBe("k".repeat(30));
    expect(JSON.stringify(request.spec.environmentVariables)).not.toContain("j".repeat(40));
    expect(JSON.stringify(request.spec.environmentVariables)).not.toContain("k".repeat(30));
    expect(RUN_SH).toContain("/opt/le-secrets");
  });

  it("secretDelivery: env puts the secrets in environmentVariables instead", () => {
    const { request } = buildLocalEditionJob({ ...base, secretDelivery: "env" });
    expect(request.spec.environmentVariables).toContainEqual({ name: "LE_JOB_SECRET", value: "j".repeat(40) });
    expect((request.spec.injectedFiles ?? []).some((f) => f.containerPath.startsWith("/opt/le-secrets"))).toBe(false);
  });

  it("passes import mode's IMPORT_CSV_URL through extra env", () => {
    const { request } = buildLocalEditionJob({ ...base, modes: ["import"], env: { IMPORT_CSV_URL: "https://example.org/stores.csv" } });
    expect(request.spec.environmentVariables).toContainEqual({ name: "IMPORT_CSV_URL", value: "https://example.org/stores.csv" });
  });

  it.each([
    ["an http app url", { appUrl: "http://localedition.pages.dev" }],
    ["a short job secret", { jobSecret: "short" }],
    ["no modes", { modes: [] }],
    ["an unknown mode", { modes: ["rebuild"] }],
    ["a duplicate mode", { modes: ["certify", "certify"] }],
    ["a missing certify.py", { bundle: { "le_http.py": "x", "requirements.txt": "y" } }],
    ["a path escape", { bundle: { ...bundle, "../etc/passwd": "x" } }],
    ["an oversized file", { bundle: { ...bundle, "big.txt": "a".repeat(MAX_INJECTED_FILE_BYTES + 1) } }],
    ["an empty file", { bundle: { ...bundle, "empty.txt": "" } }],
    ["a bad secret name", { secrets: { "bad-name": "x" } }],
    ["a bad env name", { env: { "lower": "x" } }],
  ])("rejects %s with nebius_bad_request", (_label, patch) => {
    expect(() => buildLocalEditionJob({ ...base, ...patch } as never)).toThrowError(expect.objectContaining({ code: "nebius_bad_request" }));
  });

  it("accepts a file that nearly fills the total allowance (a lone 64 KiB file no longer fits: base64 counts toward 64 KiB in all)", () => {
    const big = { ...bundle, "rails/big.txt": "a".repeat(45_000) };
    expect(() => buildLocalEditionJob({ ...base, bundle: big })).not.toThrow();
  });

  it("counts multi-byte characters in bytes, not characters", () => {
    const big = { ...bundle, "rails/big.txt": "é".repeat(MAX_INJECTED_FILE_BYTES / 2 + 1) };
    expect(() => buildLocalEditionJob({ ...base, bundle: big })).toThrowError(expect.objectContaining({ code: "nebius_bad_request" }));
  });

  it("M4: run.sh installs first (binary wheels only, hashes required) and reads the secret files only afterwards", () => {
    const install = RUN_SH.indexOf("pip install");
    const secrets = RUN_SH.indexOf("/opt/le-secrets");
    expect(install).toBeGreaterThan(0);
    expect(secrets).toBeGreaterThan(install);
    expect(RUN_SH.slice(install, RUN_SH.indexOf("\n", install))).toMatch(/--only-binary :all: --require-hashes --no-deps -r requirements\.txt/);
    // No export of anything before the install line.
    expect(RUN_SH.slice(0, install)).not.toMatch(/export /);
  });

  it("M4: the committed requirements pin every package by version and hash", async () => {
    const { JOB_BUNDLE } = await import("./job-bundle.generated");
    const text = JOB_BUNDLE["requirements.txt"];
    const entries = text.split(/\n(?=[A-Za-z0-9])/).filter((e) => e.trim());
    expect(entries.length).toBeGreaterThan(30);
    for (const entry of entries) {
      expect(entry, entry.slice(0, 40)).toMatch(/^[A-Za-z0-9._-]+==[0-9][^\s]*( \\)?\n\s+--hash=sha256:[0-9a-f]{64}/);
    }
    expect(text).toMatch(/^nemoguardrails==0\.24\.1 /m);
    expect(text).not.toMatch(/^[^#\s-][^=\n]*$/m); // no unpinned line
  });

  it("names the job from the modes and the time, the same name buildLocalEditionJob uses", () => {
    expect(localEditionJobName(["certify", "eval"], new Date("2026-11-02T00:07:30Z"))).toBe("local-edition-certify-eval-202611020007");
    expect(buildLocalEditionJob({ ...base, modes: ["certify", "eval"] }).name).toBe(localEditionJobName(["certify", "eval"], base.now));
  });

  it("printOnly: eval alone, no APP_URL and no job secret, EVAL_PRINT=1, and still the model key as a secret file", () => {
    const { request } = buildLocalEditionJob({ modes: ["eval"], printOnly: true, bundle, secrets: { NEBIUS_API_KEY: "k".repeat(30) }, now: base.now });
    const env = Object.fromEntries((request.spec.environmentVariables ?? []).map((e) => [e.name, e.value]));
    expect(env).toMatchObject({ EVAL_PRINT: "1" });
    expect(env).not.toHaveProperty("APP_URL");
    const paths = (request.spec.injectedFiles ?? []).map((f) => f.containerPath);
    expect(paths).toContain("/opt/le-secrets/NEBIUS_API_KEY");
    expect(paths).not.toContain("/opt/le-secrets/LE_JOB_SECRET");
    expect(request.spec.args).toBe("/opt/le/run.sh eval");
    expect(() => buildLocalEditionJob({ modes: ["certify"], printOnly: true, bundle })).toThrowError(expect.objectContaining({ code: "nebius_bad_request" }));
  });

  it("sends one gzipped pack instead of the loose files when given, and run.sh unpacks it", () => {
    const pack = gzipSync(Buffer.from(JSON.stringify(bundle))).toString("base64");
    const { request } = buildLocalEditionJob({ ...base, pack, secrets: { NEBIUS_API_KEY: "k".repeat(30) } });
    const paths = (request.spec.injectedFiles ?? []).map((f) => f.containerPath);
    expect(paths).toEqual(["/opt/le/run.sh", "/opt/le/bundle.json.gz", "/opt/le-secrets/LE_JOB_SECRET", "/opt/le-secrets/NEBIUS_API_KEY"]);
    expect((request.spec.injectedFiles ?? [])[1].content).toBe(pack);
    expect(RUN_SH).toContain("bundle.json.gz");
    expect(RUN_SH.indexOf("bundle.json.gz")).toBeLessThan(RUN_SH.indexOf("pip install"));
  });

  it("refuses a request whose injected files add up to more than Nebius accepts (the dry run does not check this)", () => {
    // Four 20 KB files: each is under 64 KiB, together they are over (base64 counts).
    const loose = Object.fromEntries([0, 1, 2, 3].map((i) => [`rails/f${i}.txt`, "a".repeat(20_000)]));
    expect(() => buildLocalEditionJob({ ...base, bundle: { ...bundle, ...loose } })).toThrowError(
      expect.objectContaining({ code: "nebius_bad_request", message: expect.stringContaining(String(MAX_INJECTED_TOTAL_BYTES)) }),
    );
  });

  it("rejects a pack that is not base64 or is over 64 KiB", () => {
    expect(() => buildLocalEditionJob({ ...base, pack: "not base64!" })).toThrowError(expect.objectContaining({ code: "nebius_bad_request" }));
    expect(() => buildLocalEditionJob({ ...base, pack: "A".repeat(90_000) })).toThrowError(expect.objectContaining({ code: "nebius_bad_request" }));
  });
});
