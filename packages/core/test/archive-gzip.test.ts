import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { concatAsOneMember, decodeArchiveChunk, encodeArchiveChunk, gunzip, gzip, toArchiveRow } from "@metro/core";

const rowA = toArchiveRow({ id: "bus-a", lat: 6.9, lng: 79.86, receivedAt: 1_791_685_800_100, route_id: "route-1", timestamp: 1_791_685_800_000 });
const rowB = toArchiveRow({ id: "bus-b", lat: 6.8, lng: 79.9, receivedAt: 1_791_685_802_100, current_capacity: 5, total_capacity: 60 });
const ndjson = (rows: ReadonlyArray<unknown>) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");

test("an archive chunk is gzipped NDJSON that zlib and the decoder both read", async () => {
  const bytes = await encodeArchiveChunk([rowA, rowB]);
  assert.equal(gunzipSync(bytes).toString("utf8"), ndjson([rowA, rowB]));
  assert.deepEqual(await decodeArchiveChunk(bytes), [rowA, rowB]);
});

test("concatenated chunks read back as one stream, as today's live file is built", async () => {
  const joined = Buffer.concat([await encodeArchiveChunk([rowA]), await encodeArchiveChunk([rowB])]);
  assert.equal(gunzipSync(joined).toString("utf8"), ndjson([rowA, rowB]));
});

test("gzip and gunzip are inverses for binary data", async () => {
  const body = Uint8Array.from({ length: 4096 }, (_, index) => (index * 31) % 256);
  assert.deepEqual([...(await gunzip(await gzip(body)))], [...body]);
});

test("an empty chunk decodes to no rows", async () => {
  assert.deepEqual(await decodeArchiveChunk(await encodeArchiveChunk([])), []);
});

const singleGzipMember = (body: Uint8Array) => 10 + inflateRawSync(body.subarray(10), { info: true }).engine.bytesWritten + 8 === body.length;

test("chunks joined as one member decode to the same rows as one chunk of all their rows", async () => {
  const parts = [await encodeArchiveChunk([rowA]), await encodeArchiveChunk([rowB]), await encodeArchiveChunk([])];
  const joined = await concatAsOneMember(parts);
  assert.equal(singleGzipMember(joined), true);
  assert.deepEqual(await decodeArchiveChunk(joined), await decodeArchiveChunk(await encodeArchiveChunk([rowA, rowB])));
});

test("joining no chunks gives an empty member", async () => {
  const joined = await concatAsOneMember([]);
  assert.equal(singleGzipMember(joined), true);
  assert.deepEqual(await decodeArchiveChunk(joined), []);
});
