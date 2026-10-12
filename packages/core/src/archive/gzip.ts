import type { ArchiveRow } from "./rows.js";

const through = async (bytes: Uint8Array, transform: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(transform)).arrayBuffer());

export const gzip = (bytes: Uint8Array) => through(bytes, new CompressionStream("gzip"));

export const gunzip = (bytes: Uint8Array) => through(bytes, new DecompressionStream("gzip"));

// workerd's DecompressionStream rejects anything after the first gzip member, so parts are re-gzipped as one, streamed a part at a time.
export const concatAsOneMember = (parts: ReadonlyArray<Uint8Array>) => {
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  const joined = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          const part = parts[next++];
          if (!part) return controller.close();
          reader = new Blob([new Uint8Array(part)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
        }
        const { done, value } = await reader.read();
        if (!done) return controller.enqueue(value);
        reader = undefined;
      }
    },
  });
  return new Response(joined.pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then((buffer) => new Uint8Array(buffer));
};

export const encodeArchiveChunk = (rows: ReadonlyArray<ArchiveRow>) =>
  gzip(new TextEncoder().encode(rows.map((row) => `${JSON.stringify(row)}\n`).join("")));

export const decodeArchiveChunk = async (bytes: Uint8Array): Promise<ArchiveRow[]> =>
  new TextDecoder()
    .decode(await gunzip(bytes))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ArchiveRow);
