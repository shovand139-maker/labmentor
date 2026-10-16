import { describe, expect, it } from "vitest";
import { encodeEvent, readEvents } from "@/lib/sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const e of readEvents(stream)) out.push(e);
  return out;
}

describe("readEvents", () => {
  it("reassembles events split across chunks", async () => {
    const wire =
      encodeEvent("tool", { name: "search_guide" }) +
      encodeEvent("delta", { text: "Hi" });
    const events = await collect(
      streamOf(wire.slice(0, 7), wire.slice(7, 30), wire.slice(30)),
    );
    expect(events).toEqual([
      { event: "tool", data: '{"name":"search_guide"}' },
      { event: "delta", data: '{"text":"Hi"}' },
    ]);
  });

  it("handles CRLF split between chunks, comments and multi-line data", async () => {
    const events = await collect(
      streamOf(": keep-alive\r", "\nevent: done\r\ndata: a\r\ndata: b\r\n\r\n"),
    );
    expect(events).toEqual([{ event: "done", data: "a\nb" }]);
  });

  it("drops an event the stream cut off before its blank line", async () => {
    expect(await collect(streamOf('event: done\ndata: {"answer"', ""))).toEqual(
      [],
    );
  });
});
