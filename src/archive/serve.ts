import { Effect } from "effect";
import type { ArchiveError, ArchiveStoreShape } from "./r2.js";
import { todayPrefix } from "./rows.js";

export const CATALOG_PATH = "catalog/metro.duckdb";

// DuckDB 1.1 and later say "duckdb/v1.5.6(…)"; older builds sent their HTTP library's name.
export const isDuckDbAgent = (userAgent: string | undefined) =>
  userAgent !== undefined && /^(duckdb\/|cpp-httplib\/)/i.test(userAgent);

const PASSED_THROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
];

export function catalogResponse(
  store: ArchiveStoreShape,
  request: {
    method: string;
    range: string | undefined;
    ifNoneMatch: string | undefined;
  },
): Effect.Effect<Response, ArchiveError> {
  return store
    .fetchPublic(CATALOG_PATH, {
      ...(request.range && { range: request.range }),
      ...(request.ifNoneMatch && { "if-none-match": request.ifNoneMatch }),
    })
    .pipe(
      Effect.map((upstream) => {
        const headers = new Headers({
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=300",
        });
        for (const name of PASSED_THROUGH) {
          const value = upstream.headers.get(name);
          if (value !== null) headers.set(name, value);
        }
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          headers,
        });
      }),
    );
}

export function todayResponse(
  store: ArchiveStoreShape,
  now: number,
): Effect.Effect<Response, ArchiveError> {
  return store.list(todayPrefix(now)).pipe(
    Effect.map((keys) => {
      const ordered = keys.filter((key) => key.endsWith(".ndjson.gz")).sort();
      const pending = [...ordered];
      // Gzip members placed back to back decompress as one file.
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const key = pending.shift();
          if (key === undefined) return controller.close();
          const chunk = await Effect.runPromise(store.get(key));
          controller.enqueue(new Uint8Array(await chunk.arrayBuffer()));
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "application/gzip",
          "cache-control": "public, max-age=60",
        },
      });
    }),
  );
}

export const readme = (publicUrl: string) => `Lanka Metro fleet archive

Every live bus position, as a DuckDB database you can attach:

  ATTACH 'https://metro.manasa.ai/' AS metro;
  SHOW ALL TABLES;

Tables and views:
  fixes        every position, compacted hourly into one Parquet file per day
  fixes_today  today so far, at most about five minutes old
  all_fixes    both together
  routes, stops
  load_by_route_hour, headways, silences

The Parquet files are public too, for Polars, pandas or Spark:
  ${publicUrl}/fixes/date=YYYY-MM-DD/fixes.parquet

Bus positions and load counts only; no passenger data.
`;
