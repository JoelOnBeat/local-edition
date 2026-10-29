import { AgentEvent } from "@/contract";

/** Parse a text/event-stream body into validated AgentEvents. Comment lines (heartbeats) are skipped. */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
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
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        const parsed = AgentEvent.safeParse(JSON.parse(data));
        if (parsed.success) yield parsed.data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
