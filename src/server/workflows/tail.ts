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
  /** First wait between laps when nothing is new. Default 1.5 s; it grows by half each quiet lap up to `maxPollMs`. */
  pollMs?: number;
  /** Longest wait between quiet laps. Default 5 s. */
  maxPollMs?: number;
  /** D1 queries this stream may spend before it ends and the client reconnects (a Worker invocation allows 1,000). Default 900. */
  maxQueries?: number;
  /** Runs once when the stream ends for any reason (finished, client left, error): release the tail slot here. */
  onClose?: () => void | Promise<void>;
  /** Close after this long even if the run is still going; the client reconnects with Last-Event-ID. Default 20 min. */
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const encoder = new TextEncoder();
const frame = (seq: number, data: unknown) => encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(data)}\n\n`);

/** Quiet laps wait longer each time, so an idle tail costs a few queries a minute, not a few per second. */
export const POLL_MS = 1_500;
export const MAX_POLL_MS = 5_000;
export const MAX_QUERIES = 900;

/**
 * SSE response that tails a run's event log in D1. `: open` goes out at once (OpenNext #1468: a stream that
 * has sent nothing can hang), then every event after `afterSeq` with `id: <seq>`, a `: ping` heartbeat every
 * 15 s, and the stream ends when the run is finished and the log is drained. The client aborting (or Workers
 * not reporting it, #691) only stops the polling; the Workflow itself never depends on this stream.
 *
 * Cost control: a lap that found events costs one D1 query (the run's status is read only when a lap is quiet), quiet
 * laps back off from 1.5 s to 5 s, and the stream ends gracefully after `maxQueries` so it never reaches the Worker's
 * per-invocation limit; the client reconnects with Last-Event-ID and loses nothing.
 */
export function tailRun(opts: TailOptions): Response {
  const { runLog, runId } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepFor;
  const basePoll = opts.pollMs ?? POLL_MS;
  const maxPoll = Math.max(basePoll, opts.maxPollMs ?? MAX_POLL_MS);
  const maxQueries = opts.maxQueries ?? MAX_QUERIES;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const deadline = now() + (opts.maxMs ?? 20 * 60_000);
  let stopped = false;
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    void Promise.resolve(opts.onClose?.()).catch(() => undefined);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: Uint8Array | string) => {
        if (!stopped) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      };
      const stop = () => {
        if (stopped) return;
        stopped = true;
        try { controller.close(); } catch { /* already closed */ }
        closeOnce();
      };
      opts.signal?.addEventListener("abort", stop, { once: true });
      send(": open\n\n");
      let cursor = opts.afterSeq ?? 0;
      let lastBeat = now();
      let queries = 0;
      let wait = basePoll;
      const read = async () => {
        queries++;
        const events = await runLog.readFrom(runId, cursor);
        for (const e of events) {
          send(frame(e.seq, e.event));
          cursor = e.seq;
        }
        if (events.length) lastBeat = now();
        return events.length;
      };
      try {
        while (!stopped && now() < deadline && queries < maxQueries) {
          if (await read()) {
            wait = basePoll;
            continue;
          }
          // A quiet lap: is the run still going? (Events are read first, so one that lands in between is read next lap.)
          queries++;
          const run = await runLog.get(runId);
          if (!run) {
            send(frame(cursor + 1, { type: "error", code: "run_not_found", message: "That run does not exist." }));
            break;
          }
          if (run.status !== "running") {
            if (await read()) continue; // the run ended after the quiet read above: drain what it wrote last
            break;
          }
          if (now() - run.updatedAt > RUN_STALE_MS) {
            await runLog.finish(runId, "failed");
            send(frame(cursor + 1, { type: "error", code: "run_stalled", message: "The build stopped responding. Start it again." }));
            break;
          }
          if (now() - lastBeat >= heartbeatMs) {
            send(": ping\n\n");
            lastBeat = now();
          }
          await sleep(wait);
          wait = Math.min(maxPoll, Math.ceil(wait * 1.5));
        }
      } catch (e) {
        log.error("tail failed", { err: e });
        send(frame(cursor + 1, { type: "error", code: "stream_failed", message: "The run stopped unexpectedly." }));
      } finally {
        stop();
        closeOnce();
      }
    },
    cancel() {
      stopped = true;
      closeOnce();
    },
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
