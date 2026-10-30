import { AgentEvent } from "@/contract";

/** One parsed frame: the event and the server's `id:` for it (the event-log sequence number), null when the frame had none. */
export interface SeqEvent {
  seq: number | null;
  event: AgentEvent;
}

/** Parse a text/event-stream body into validated AgentEvents. Comment lines (heartbeats) are skipped. */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  for await (const frame of parseSseFrames(body)) yield frame.event;
}

/** Like parseSseStream, but keeps each frame's `id:` so a dropped connection can resume with Last-Event-ID. */
export async function* parseSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SeqEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
        const lines = block.split(/\r?\n/);
        const idLine = lines.find((l) => l.startsWith("id:"));
        const id = idLine ? Number(idLine.slice(3).trim()) : NaN;
        const data = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // a torn frame is skipped, the stream carries on
        }
        const parsed = AgentEvent.safeParse(json);
        if (parsed.success) yield { seq: Number.isInteger(id) && id >= 0 ? id : null, event: parsed.data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
