import { gzipSync } from "node:zlib";
import type { ArchiveRow } from "@metro/core";

export function encodeChunk(rows: ReadonlyArray<ArchiveRow>): Uint8Array {
  return gzipSync(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}
