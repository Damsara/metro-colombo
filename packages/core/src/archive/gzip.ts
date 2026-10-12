import type { ArchiveRow } from "./rows.js";

const through = async (bytes: Uint8Array, transform: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(transform)).arrayBuffer());

export const gzip = (bytes: Uint8Array) => through(bytes, new CompressionStream("gzip"));

export const gunzip = (bytes: Uint8Array) => through(bytes, new DecompressionStream("gzip"));

export const encodeArchiveChunk = (rows: ReadonlyArray<ArchiveRow>) =>
  gzip(new TextEncoder().encode(rows.map((row) => `${JSON.stringify(row)}\n`).join("")));

export const decodeArchiveChunk = async (bytes: Uint8Array): Promise<ArchiveRow[]> =>
  new TextDecoder()
    .decode(await gunzip(bytes))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ArchiveRow);
