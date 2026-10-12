import { Clock, Effect, Semaphore } from "effect";
import {
  type ArchiveRow,
  chunkKey,
  dedupe,
  encodeArchiveChunk,
  hourStartKey,
  type ObjectStoreShape,
  type RecordedFix,
  toArchiveRow,
} from "@metro/core";

export const LIVE_ARCHIVE_KEY = "today/live.ndjson.gz";
export const FLUSH_EVERY_MS = 5 * 60_000;
// About an hour of fixes at a busy time; older ones go if storage stays down longer.
export const MAX_PENDING_ROWS = 100_000;

const HOUR_MS = 3_600_000;
const CHUNK_CACHE = "public, max-age=31536000, immutable";
const LIVE_CACHE = "public, max-age=60";
const NDJSON = "application/x-ndjson";

export type RecorderStatus = {
  readonly lastWriteAt: number | null;
  readonly failingSince: number | null;
  readonly liveFailingSince: number | null;
  readonly pendingRows: number;
  readonly droppedRows: number;
};

export type RecorderShape = {
  readonly record: (fix: RecordedFix) => void;
  readonly flush: Effect.Effect<void>;
  readonly flushIfDue: Effect.Effect<void>;
  readonly status: Effect.Effect<RecorderStatus>;
};

export const makeRecorder = (options: {
  readonly store: ObjectStoreShape;
  readonly instance: string;
  readonly maxPendingRows?: number;
}) =>
  Effect.gen(function* () {
    const cap = options.maxPendingRows ?? MAX_PENDING_ROWS;
    let buffer: RecordedFix[] = [];
    const pending: { readonly key: string; rows: ArchiveRow[] }[] = [];
    let recent: { readonly key: string; readonly rows: ReadonlyArray<ArchiveRow> }[] = [];
    let lastFlushAt = yield* Clock.currentTimeMillis;
    let lastChunkAt = Number.NEGATIVE_INFINITY;
    let lastWriteAt: number | null = null;
    let failingSince: number | null = null;
    let liveFailingSince: number | null = null;
    let droppedRows = 0;
    const lock = yield* Semaphore.make(1);

    const pendingTotal = () => pending.reduce((sum, chunk) => sum + chunk.rows.length, 0);

    const trim = () => {
      let excess = pendingTotal() - cap;
      while (excess > 0 && pending.length) {
        const oldest = pending[0];
        const cut = Math.min(oldest.rows.length, excess);
        oldest.rows = oldest.rows.slice(cut);
        if (!oldest.rows.length) pending.shift();
        excess -= cut;
        droppedRows += cut;
      }
    };

    const upload = (key: string, bytes: Uint8Array, cacheControl: string) =>
      options.store.put(key, bytes, { contentType: NDJSON, cacheControl }).pipe(
        Effect.as(true),
        Effect.catch((error) => Effect.as(Effect.logWarning("archive upload failed", { key, error: error.message }), false)),
      );

    const flushNow = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      lastFlushAt = now;
      const rows = dedupe(buffer.map(toArchiveRow));
      buffer = [];
      if (rows.length) {
        // Chunk names have one-second resolution, so a second flush in the same second moves on a second.
        const chunkAt = Math.max(now, lastChunkAt + 1_000);
        lastChunkAt = chunkAt;
        pending.push({ key: chunkKey(chunkAt, options.instance), rows });
      }
      trim();
      let uploaded = false;
      while (pending.length) {
        const chunk = pending[0];
        const bytes = yield* Effect.promise(() => encodeArchiveChunk(chunk.rows));
        if (!(yield* upload(chunk.key, bytes, CHUNK_CACHE))) {
          failingSince ??= now;
          break;
        }
        pending.shift();
        recent.push({ key: chunk.key, rows: chunk.rows });
        uploaded = true;
        lastWriteAt = now;
        failingSince = null;
      }
      if (!uploaded) return;
      const since = hourStartKey(now - HOUR_MS);
      recent = recent.filter((chunk) => chunk.key >= since);
      // One gzip member, since workerd's DecompressionStream rejects anything after the first.
      const live = yield* Effect.promise(() => encodeArchiveChunk(recent.flatMap((chunk) => chunk.rows)));
      const liveUploaded = yield* upload(LIVE_ARCHIVE_KEY, live, LIVE_CACHE);
      liveFailingSince = liveUploaded ? null : (liveFailingSince ?? now);
    });

    const flush = lock.withPermits(1)(flushNow);

    const shape: RecorderShape = {
      record: (fix) => void buffer.push(fix),
      flush,
      flushIfDue: Effect.flatMap(Clock.currentTimeMillis, (now) => (now - lastFlushAt >= FLUSH_EVERY_MS ? flush : Effect.void)),
      status: Effect.sync(() => ({ lastWriteAt, failingSince, liveFailingSince, pendingRows: buffer.length + pendingTotal(), droppedRows })),
    };
    return shape;
  });
