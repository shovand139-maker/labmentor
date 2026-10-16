/** Server-sent events: encoding for our responses and an incremental parser for streams we read. */

export type ServerEvent = { event: string; data: string };

export function encodeEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse an event stream as it arrives. Handles events split across chunks, CRLF line endings, multi-line
 * data and comment lines, per the WHATWG event stream format.
 */
export async function* readEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerEvent> {
  const reader = stream
    .pipeThrough(
      new TextDecoderStream() as unknown as ReadableWritablePair<
        string,
        Uint8Array
      >,
    )
    .getReader();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += value;
      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // A trailing "\r" may be the first half of "\r\n" in the next chunk.
        if (!done && newline === buffer.length - 1 && buffer[newline] === "\r")
          break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(
          newline + (buffer.startsWith("\r\n", newline) ? 2 : 1),
        );
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const raw = colon < 0 ? "" : line.slice(colon + 1);
          const value = raw.startsWith(" ") ? raw.slice(1) : raw;
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
      }
      if (done) break;
    }
    // An event not terminated by a blank line is incomplete and, per the spec, dropped.
  } finally {
    reader.releaseLock();
  }
}
