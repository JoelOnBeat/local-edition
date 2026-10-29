import { createLogger } from "../log";
import { RUN_STALE_MS, type RunLog } from "./run-log";

const log = createLogger("sse-tail");

export interface TailOptions {
  runLog: RunLog;
  runId: string;
  /** Replay starts after this seq (the client's Last-Event-ID); 0 replays everything. */
  afterSeq?: number;
  signal?: AbortSignal;
  /** Heartbeat comment interval. Default 15 s. */
  heartbeatMs?: number;
  pollMs?: number;
  /** Close after this long even if the run is still going; the client reconnects with Last-Event-ID. Default 20 min. */
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const encoder = new TextEncoder();
const frame = (seq: number, data: unknown) => encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * SSE response that tails a run's event log in D1. `: open` goes out at once (OpenNext #1468: a stream that
 * has sent nothing can hang), then every event after `afterSeq` with `id: <seq>`, a `: ping` heartbeat every
 * 15 s, and the stream ends when the run is finished and the log is drained. The client aborting (or Workers
 * not reporting it, #691) only stops the polling; the Workflow itself never depends on this stream.
 */
export function tailRun(opts: TailOptions): Response {
  const { runLog, runId } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepFor;
  const pollMs = opts.pollMs ?? 800;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const deadline = now() + (opts.maxMs ?? 20 * 60_000);
  let stopped = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: Uint8Array | string) => {
        if (!stopped) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      };
      const stop = () => {
        if (stopped) return;
        stopped = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      opts.signal?.addEventListener("abort", stop, { once: true });
      send(": open\n\n");
      let cursor = opts.afterSeq ?? 0;
      let lastBeat = now();
      try {
        while (!stopped && now() < deadline) {
          // Status first, then events: a run that finishes between the two reads is drained on the next lap.
          const run = await runLog.get(runId);
          const events = await runLog.readFrom(runId, cursor);
          for (const e of events) {
            send(frame(e.seq, e.event));
            cursor = e.seq;
          }
          if (events.length) lastBeat = now();
          if (!run) {
            send(frame(cursor + 1, { type: "error", code: "run_not_found", message: "That run does not exist." }));
            break;
          }
          if (run.status !== "running" && !events.length) break;
          if (run.status === "running" && now() - run.updatedAt > RUN_STALE_MS) {
            await runLog.finish(runId, "failed");
            send(frame(cursor + 1, { type: "error", code: "run_stalled", message: "The build stopped responding. Start it again." }));
            break;
          }
          if (!events.length && now() - lastBeat >= heartbeatMs) {
            send(": ping\n\n");
            lastBeat = now();
          }
          if (!events.length) await sleep(pollMs);
        }
      } catch (e) {
        log.error("tail failed", { err: e });
        send(frame(cursor + 1, { type: "error", code: "stream_failed", message: "The run stopped unexpectedly." }));
      } finally {
        stop();
      }
    },
    cancel() { stopped = true; },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
