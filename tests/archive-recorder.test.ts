import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { ArchiveError, type ArchiveStoreShape } from "../src/archive/r2.js";
import { makeFlusher } from "../src/archive/recorder.js";
import type { RecordedFix } from "../src/archive/rows.js";

const fix = (id: string, timestamp: number): RecordedFix => ({
  id,
  lat: 6.9,
  lng: 79.9,
  receivedAt: timestamp + 1000,
  timestamp,
});

const fakeStore = () => {
  const puts: { key: string; body: Uint8Array }[] = [];
  let failing = false;
  const store: ArchiveStoreShape = {
    enabled: true,
    publicUrl: "https://data.example.test",
    put: (key, body) =>
      failing
        ? Effect.fail(new ArchiveError({ message: "down", status: 503 }))
        : Effect.sync(() => void puts.push({ key, body })),
    list: () => Effect.succeed([]),
    get: () => Effect.die("unused"),
    fetchPublic: () => Effect.die("unused"),
  };
  return {
    puts,
    store,
    fail: (value: boolean) => {
      failing = value;
    },
  };
};

const rowsOf = (body: Uint8Array) =>
  gunzipSync(body)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).bus_id);

test("a flush uploads one deduplicated chunk named by Colombo time", async () => {
  const { puts, store } = fakeStore();
  const batches = [[fix("a", 1), fix("a", 1), fix("b", 2)]];
  const flush = makeFlusher({
    take: Effect.sync(() => batches.shift() ?? []),
    store,
    instance: "pod-a",
    now: () => Date.UTC(2026, 9, 11, 18, 45, 7),
  });
  await Effect.runPromise(flush);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, "raw/2026-10-12/001507-pod-a.ndjson.gz");
  assert.deepEqual(rowsOf(puts[0].body), ["a", "b"]);
});

test("nothing is uploaded when no fixes arrived", async () => {
  const { puts, store } = fakeStore();
  const flush = makeFlusher({
    take: Effect.succeed([]),
    store,
    instance: "pod-a",
    now: () => 0,
  });
  await Effect.runPromise(flush);
  assert.equal(puts.length, 0);
});

test("chunks that fail to upload are retried in order on the next flush", async () => {
  const { puts, store, fail } = fakeStore();
  const batches = [[fix("a", 1)], [fix("b", 2)]];
  let clock = Date.UTC(2026, 9, 11, 0, 0, 0);
  const flush = makeFlusher({
    take: Effect.sync(() => batches.shift() ?? []),
    store,
    instance: "x",
    now: () => (clock += 300_000),
  });
  fail(true);
  await Effect.runPromise(flush);
  assert.equal(puts.length, 0);
  fail(false);
  await Effect.runPromise(flush);
  assert.deepEqual(
    puts.map((put) => rowsOf(put.body)),
    [["a"], ["b"]],
  );
});

test("while storage is down, the oldest queued rows are dropped past the cap", async () => {
  const { puts, store, fail } = fakeStore();
  const batches = [[fix("a", 1), fix("b", 2)], [fix("c", 3)], [fix("d", 4)]];
  let clock = 0;
  const flush = makeFlusher({
    take: Effect.sync(() => batches.shift() ?? []),
    store,
    instance: "x",
    now: () => (clock += 300_000),
    maxPendingRows: 2,
  });
  fail(true);
  await Effect.runPromise(flush);
  await Effect.runPromise(flush);
  await Effect.runPromise(flush);
  fail(false);
  await Effect.runPromise(flush);
  assert.deepEqual(
    puts.flatMap((put) => rowsOf(put.body)),
    ["c", "d"],
  );
});
