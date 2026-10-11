import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import type { ArchiveError, ArchiveStoreShape } from "./r2.js";

export const CATALOG_PATH = "catalog/metro.duckdb";

// DuckDB 1.1 and later say "duckdb/v1.5.6(…)"; older builds sent their HTTP library's name.
export const isDuckDbAgent = (userAgent: string | undefined) =>
  userAgent !== undefined && /^(duckdb\/|cpp-httplib\/)/i.test(userAgent);

const PASSED_THROUGH = [
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
): Effect.Effect<HttpServerResponse.HttpServerResponse, ArchiveError> {
  return store
    .fetchPublic(CATALOG_PATH, {
      ...(request.range && { range: request.range }),
      ...(request.ifNoneMatch && { "if-none-match": request.ifNoneMatch }),
    })
    .pipe(
      Effect.map((upstream) => {
        const headers: Record<string, string> = {
          "accept-ranges": "bytes",
          // The site root answers browsers and DuckDB differently, so shared caches must not keep it.
          "cache-control": "private, max-age=300",
          vary: "User-Agent",
        };
        for (const name of PASSED_THROUGH) {
          const value = upstream.headers[name];
          if (value !== undefined) headers[name] = value;
        }
        const options = {
          status: upstream.status,
          headers,
          contentType: "application/octet-stream",
        };
        return request.method === "HEAD"
          ? HttpServerResponse.empty(options)
          : HttpServerResponse.stream(upstream.stream, options);
      }),
    );
}
