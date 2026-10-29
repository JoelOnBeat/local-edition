import type { AgentEvent } from "@/contract";
import { createLogger } from "../log";

const log = createLogger("sse");

export function encodeSseEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SseOptions {
  /** Comment-line keepalive interval. Default 15 s. */
  heartbeatMs?: number;
  /** Aborts the stream (e.g. request.signal). */
  signal?: AbortSignal;
}

/**
 * Stream an async sequence of AgentEvents as text/event-stream. Heartbeats are `: ping` comments.
 * If the source throws, the client gets one generic `error` event (no stack, no upstream text).
 */
export function sseResponse(events: AsyncIterable<AgentEvent>, opts: SseOptions = {}): Response {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      opts.signal?.addEventListener("abort", () => { void iterator.return?.(); finish(); }, { once: true });
      send(": open\n\n");
      timer = setInterval(() => send(": ping\n\n"), heartbeatMs);
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done || closed) break;
          send(encodeSseEvent(next.value));
        }
      } catch (e) {
        log.error("event source failed", { err: e });
        send(encodeSseEvent({ type: "error", code: "stream_failed", message: "The run stopped unexpectedly." }));
      } finally {
        finish();
      }
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      void iterator.return?.();
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
