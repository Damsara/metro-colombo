import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { ArchiveError, type ArchiveStoreShape } from "../src/archive/r2.js";
import { LIVE_KEY, makeFlusher } from "../src/archive/recorder.js";
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
    fetchPublic: () => Effect.die("unused"),
  };
  return {
    puts,
    store,
    chunks: () => puts.filter((put) => put.key !== LIVE_KEY),
    live: () => puts.filter((put) => put.key === LIVE_KEY).at(-1),
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
    .filter(Boolean)
    .map((line) => JSON.parse(line).bus_id);

const batches = (...lists: RecordedFix[][]) =>
  Effect.sync(() => lists.shift() ?? []);

const at = (iso: string) => Date.parse(iso);

const run = (effect: Effect.Effect<void>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

test("a flush uploads one deduplicated chunk named by Colombo time", async () => {
  const { chunks, store } = fakeStore();
  await run(
    Effect.gen(function* () {
      const flush = makeFlusher({
        take: batches([fix("a", 1), fix("a", 1), fix("b", 2)]),
        store,
        instance: "pod-a",
      });
      yield* TestClock.setTime(at("2026-10-11T18:45:07Z"));
      yield* flush;
    }),
  );
  assert.equal(chunks().length, 1);
  assert.equal(chunks()[0].key, "raw/2026-10-12/001507-pod-a.ndjson.gz");
  assert.deepEqual(rowsOf(chunks()[0].body), ["a", "b"]);
});

test("nothing is uploaded when no fixes arrived", async () => {
  const { puts, store } = fakeStore();
  await run(makeFlusher({ take: batches(), store, instance: "pod-a" }));
  assert.equal(puts.length, 0);
});

test("chunks that fail to upload are retried in order on the next flush", async () => {
  const { chunks, store, fail } = fakeStore();
  await run(
    Effect.gen(function* () {
      const flush = makeFlusher({
        take: batches([fix("a", 1)], [fix("b", 2)]),
        store,
        instance: "x",
      });
      yield* TestClock.setTime(at("2026-10-11T00:00:00Z"));
      fail(true);
      yield* flush;
      fail(false);
      yield* TestClock.adjust("5 minutes");
      yield* flush;
    }),
  );
  assert.deepEqual(
    chunks().map((put) => rowsOf(put.body)),
    [["a"], ["b"]],
  );
});

test("while storage is down, the oldest queued rows are dropped past the cap", async () => {
  const { chunks, store, fail } = fakeStore();
  await run(
    Effect.gen(function* () {
      const flush = makeFlusher({
        take: batches([fix("a", 1), fix("b", 2)], [fix("c", 3)], [fix("d", 4)]),
        store,
        instance: "x",
        maxPendingRows: 2,
      });
      fail(true);
      for (let i = 0; i < 3; i++) {
        yield* TestClock.adjust("5 minutes");
        yield* flush;
      }
      fail(false);
      yield* TestClock.adjust("5 minutes");
      yield* flush;
    }),
  );
  assert.deepEqual(
    chunks().flatMap((put) => rowsOf(put.body)),
    ["c", "d"],
  );
});

test("the live file holds this hour and the last, straight from memory", async () => {
  const { live, store } = fakeStore();
  await run(
    Effect.gen(function* () {
      const flush = makeFlusher({
        take: batches([fix("08:10", 1)], [fix("09:20", 2)], [fix("10:05", 3)]),
        store,
        instance: "x",
      });
      // Colombo is UTC+05:30, so 02:40Z is 08:10 there.
      yield* TestClock.setTime(at("2026-10-12T02:40:00Z"));
      yield* flush;
      yield* TestClock.setTime(at("2026-10-12T03:50:00Z"));
      yield* flush;
      yield* TestClock.setTime(at("2026-10-12T04:35:00Z"));
      yield* flush;
    }),
  );
  assert.deepEqual(rowsOf(live()!.body), ["09:20", "10:05"]);
});
