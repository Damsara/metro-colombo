import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { decodeArchiveChunk, type RecordedFix, StoreError } from "@metro/core";
import { memoryObjectStore, spyObjectStore, testClockAt } from "@metro/core/testing";
import { LIVE_ARCHIVE_KEY, makeRecorder, MAX_PENDING_ROWS, type RecorderShape } from "@metro/fleet";

const T0 = Date.parse("2026-10-12T08:00:00+05:30");
const SECOND = 1_000;
const MINUTE = 60_000;
const fix = (id: string, at: number): RecordedFix => ({ id, lat: 6.9, lng: 79.86, receivedAt: at, timestamp: at });

const withRecorder = <A>(
  maxPendingRows: number | undefined,
  use: (recorder: RecorderShape, spy: ReturnType<typeof spyObjectStore>) => Effect.Effect<A>,
) => {
  const spy = spyObjectStore(memoryObjectStore());
  return Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store: spy.store, instance: "fleet", ...(maxPendingRows ? { maxPendingRows } : {}) });
      return { result: yield* use(recorder, spy), spy };
    }).pipe(Effect.provide(testClockAt(T0))),
  );
};

const ids = async (body: Uint8Array) => (await decodeArchiveChunk(body)).map((row) => row.bus_id);

test("a flush writes one deduplicated chunk and the live file", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      recorder.record(fix("a", T0));
      recorder.record(fix("b", T0 + SECOND));
      yield* recorder.flush;
    }),
  );
  assert.deepEqual(spy.puts.map((put) => put.key), ["raw/2026-10-12/080000-fleet.ndjson.gz", LIVE_ARCHIVE_KEY]);
  assert.deepEqual(await ids(spy.puts[0].body), ["a", "b"]);
  assert.equal(spy.puts[0].options.cacheControl, "public, max-age=31536000, immutable");
  assert.equal(spy.puts[0].options.contentType, "application/x-ndjson");
  assert.deepEqual([...spy.puts[1].body], [...spy.puts[0].body]);
  assert.equal(spy.puts[1].options.cacheControl, "public, max-age=60");
});

test("nothing recorded writes nothing", async () => {
  const { spy } = await withRecorder(undefined, (recorder) => recorder.flush);
  assert.deepEqual(spy.puts, []);
});

test("failed uploads stay pending and go up in order once storage recovers", async () => {
  const { result, spy } = await withRecorder(undefined, (recorder, store) =>
    Effect.gen(function* () {
      store.setFailing(true);
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("b", T0 + 5 * MINUTE));
      yield* recorder.flush;
      const failing = yield* recorder.status;
      store.setFailing(false);
      yield* TestClock.adjust(5 * MINUTE);
      yield* recorder.flush;
      return { failing, recovered: yield* recorder.status };
    }),
  );
  assert.deepEqual(result.failing, { lastWriteAt: null, failingSince: T0, liveFailingSince: null, pendingRows: 2, droppedRows: 0 });
  assert.deepEqual(result.recovered, { lastWriteAt: T0 + 10 * MINUTE, failingSince: null, liveFailingSince: null, pendingRows: 0, droppedRows: 0 });
  assert.deepEqual(spy.puts.map((put) => put.key), [
    "raw/2026-10-12/080000-fleet.ndjson.gz",
    "raw/2026-10-12/080500-fleet.ndjson.gz",
    LIVE_ARCHIVE_KEY,
  ]);
  assert.deepEqual(await ids(spy.puts[2].body), ["a", "b"]);
});

test("pending rows are capped, dropping the oldest and counting them", async () => {
  const { result, spy } = await withRecorder(2, (recorder, store) =>
    Effect.gen(function* () {
      store.setFailing(true);
      recorder.record(fix("a", T0));
      recorder.record(fix("b", T0 + SECOND));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("c", T0 + 5 * MINUTE));
      yield* recorder.flush;
      store.setFailing(false);
      yield* TestClock.adjust(5 * MINUTE);
      yield* recorder.flush;
      return yield* recorder.status;
    }),
  );
  assert.equal(result.droppedRows, 1);
  assert.deepEqual(await ids(spy.puts[0].body), ["b"]);
  assert.deepEqual(await ids(spy.puts[1].body), ["c"]);
});

test("by default 100,000 rows stay pending and the next one drops the oldest", async () => {
  const { result } = await withRecorder(undefined, (recorder, store) =>
    Effect.gen(function* () {
      store.setFailing(true);
      for (let row = 0; row < 100_000; row++) recorder.record(fix(`bus-${row}`, T0));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("late", T0 + 5 * MINUTE));
      yield* recorder.flush;
      return yield* recorder.status;
    }),
  );
  assert.deepEqual([result.pendingRows, result.droppedRows], [100_000, 1]);
  assert.equal(MAX_PENDING_ROWS, 100_000);
});

test("two flushes in the same second never reuse a chunk name", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      recorder.record(fix("b", T0));
      yield* recorder.flush;
    }),
  );
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY).map((put) => put.key);
  assert.deepEqual(chunks, ["raw/2026-10-12/080000-fleet.ndjson.gz", "raw/2026-10-12/080001-fleet.ndjson.gz"]);
});

test("the live file keeps only chunks since the start of the previous hour", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(90 * MINUTE);
      recorder.record(fix("b", T0 + 90 * MINUTE));
      yield* recorder.flush;
      yield* TestClock.adjust(35 * MINUTE);
      recorder.record(fix("c", T0 + 125 * MINUTE));
      yield* recorder.flush;
    }),
  );
  const lives = spy.puts.filter((put) => put.key === LIVE_ARCHIVE_KEY);
  assert.deepEqual(await ids(lives[1].body), ["a", "b"]);
  assert.deepEqual(await ids(lives[2].body), ["b", "c"]);
});

// workerd's DecompressionStream rejects anything after the first gzip member, so the live file must be exactly one.
const singleGzipMember = (body: Uint8Array) => 10 + inflateRawSync(body.subarray(10), { info: true }).engine.bytesWritten + 8 === body.length;

test("the live file is one gzip member however many chunks it spans", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("b", T0 + 5 * MINUTE));
      yield* recorder.flush;
    }),
  );
  const lives = spy.puts.filter((put) => put.key === LIVE_ARCHIVE_KEY);
  assert.equal(singleGzipMember(lives[1].body), true);
  assert.deepEqual(await ids(lives[1].body), ["a", "b"]);
});

test("a flush is due only every 5 minutes", async () => {
  const { result, spy } = await withRecorder(undefined, (recorder, store) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* TestClock.adjust(5 * MINUTE - SECOND);
      yield* recorder.flushIfDue;
      const early = store.puts.length;
      yield* TestClock.adjust(SECOND);
      yield* recorder.flushIfDue;
      return early;
    }),
  );
  assert.equal(result, 0);
  assert.equal(spy.puts[0].key, "raw/2026-10-12/080500-fleet.ndjson.gz");
});

const slowPuts = (spy: ReturnType<typeof spyObjectStore>) => ({
  ...spy.store,
  put: (...args: Parameters<typeof spy.store.put>) =>
    Effect.andThen(Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5))), spy.store.put(...args)),
});

test("concurrent flushes upload every row exactly once and the live file has no duplicates", async () => {
  const spy = spyObjectStore(memoryObjectStore());
  await Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store: slowPuts(spy), instance: "fleet" });
      recorder.record(fix("a", T0));
      yield* Effect.all(
        [recorder.flush, Effect.andThen(Effect.sync(() => recorder.record(fix("b", T0 + SECOND))), recorder.flush)],
        { concurrency: "unbounded" },
      );
    }).pipe(Effect.provide(testClockAt(T0))),
  );
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY);
  assert.deepEqual(chunks.map((put) => put.key), ["raw/2026-10-12/080000-fleet.ndjson.gz", "raw/2026-10-12/080001-fleet.ndjson.gz"]);
  assert.deepEqual((await Promise.all(chunks.map((put) => ids(put.body)))).flat(), ["a", "b"]);
  const lives = spy.puts.filter((put) => put.key === LIVE_ARCHIVE_KEY);
  assert.deepEqual(await ids(lives[lives.length - 1].body), ["a", "b"]);
});

test("repeated flushes in one second chain onto the next free second", async () => {
  const { spy } = await withRecorder(undefined, (recorder) =>
    Effect.gen(function* () {
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      recorder.record(fix("b", T0));
      yield* recorder.flush;
      yield* TestClock.adjust(SECOND);
      recorder.record(fix("c", T0 + SECOND));
      yield* recorder.flush;
    }),
  );
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY).map((put) => put.key);
  assert.deepEqual(chunks, [
    "raw/2026-10-12/080000-fleet.ndjson.gz",
    "raw/2026-10-12/080001-fleet.ndjson.gz",
    "raw/2026-10-12/080002-fleet.ndjson.gz",
  ]);
});

test("a bumped name past midnight lands in the next day and the live window drops the old hour", async () => {
  const midnight = Date.parse("2026-10-13T00:00:00+05:30");
  const spy = spyObjectStore(memoryObjectStore());
  await Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store: spy.store, instance: "fleet" });
      recorder.record(fix("a", midnight - SECOND));
      yield* recorder.flush;
      recorder.record(fix("b", midnight - SECOND));
      yield* recorder.flush;
      yield* TestClock.adjust(91 * MINUTE);
      recorder.record(fix("c", midnight + 90 * MINUTE));
      yield* recorder.flush;
    }).pipe(Effect.provide(testClockAt(midnight - SECOND))),
  );
  const chunks = spy.puts.filter((put) => put.key !== LIVE_ARCHIVE_KEY);
  assert.deepEqual(chunks.map((put) => put.key), [
    "raw/2026-10-12/235959-fleet.ndjson.gz",
    "raw/2026-10-13/000000-fleet.ndjson.gz",
    "raw/2026-10-13/013059-fleet.ndjson.gz",
  ]);
  const lives = spy.puts.filter((put) => put.key === LIVE_ARCHIVE_KEY);
  assert.deepEqual(await ids(lives[lives.length - 1].body), ["b", "c"]);
});

test("a failed live upload shows in the status and clears on the next success", async () => {
  const spy = spyObjectStore(memoryObjectStore());
  let liveDown = true;
  const failLive = {
    ...spy.store,
    put: (...args: Parameters<typeof spy.store.put>) =>
      args[0] === LIVE_ARCHIVE_KEY && liveDown
        ? Effect.fail(new StoreError({ message: "live refused", status: 503 }))
        : spy.store.put(...args),
  };
  const { failed, recovered } = await Effect.runPromise(
    Effect.gen(function* () {
      const recorder = yield* makeRecorder({ store: failLive, instance: "fleet" });
      recorder.record(fix("a", T0));
      yield* recorder.flush;
      const failed = yield* recorder.status;
      liveDown = false;
      yield* TestClock.adjust(5 * MINUTE);
      recorder.record(fix("b", T0 + 5 * MINUTE));
      yield* recorder.flush;
      return { failed, recovered: yield* recorder.status };
    }).pipe(Effect.provide(testClockAt(T0))),
  );
  assert.equal(failed.liveFailingSince, T0);
  assert.equal(failed.failingSince, null);
  assert.equal(recovered.liveFailingSince, null);
});
