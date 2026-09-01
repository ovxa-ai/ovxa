import { safeParseSurfaceEvent, type SurfaceEvent } from "@ovxa/protocol";

/**
 * Server-sent events carrying the surface protocol.
 *
 * The event name is left off the wire and the discriminated `type` inside the
 * payload is used instead, so a plain `onmessage` handler — or any SSE client
 * in any language — receives every event without registering listeners per
 * event name.
 */
export function encodeSseEvent(event: SurfaceEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Nginx and most proxies buffer by default, which would defeat streaming.
  "x-accel-buffering": "no",
} as const;

/**
 * Splits a byte stream into SSE `data:` payloads.
 *
 * Chunk boundaries fall anywhere, including mid-JSON, so frames are only
 * released on a blank line. Comment lines (`:` heartbeats) are ignored.
 */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const frames: string[] = [];

    for (;;) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data.length > 0) frames.push(data);
    }

    return frames;
  }
}

type ByteStream = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
    releaseLock(): void;
  };
};

/**
 * Reads a `fetch` response body as surface events. Malformed frames are
 * dropped rather than thrown: one bad frame must not end a stream that is
 * otherwise delivering a working interface.
 */
export async function* readSurfaceEventStream(
  body: ByteStream | null,
): AsyncGenerator<SurfaceEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      for (const frame of sse.push(decoder.decode(value, { stream: true }))) {
        try {
          const event = safeParseSurfaceEvent(JSON.parse(frame));
          if (event) yield event;
        } catch {
          // Not JSON: skip the frame and keep the stream alive.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
