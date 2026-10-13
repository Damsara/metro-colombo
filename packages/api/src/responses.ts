import { Data, Effect, type Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import type { UpstreamError } from "@metro/upstream";
import type { ReferenceMissing } from "./reader.js";

// Reference data changes a few times a day at most; errors and live data aren't reused.
export const CACHE = {
  reference: "public, max-age=3600, stale-while-revalidate=86400",
  geometry: "public, max-age=86400, stale-while-revalidate=604800",
  none: "no-store",
} as const;

export class BadRequest extends Data.TaggedError("BadRequest")<{
  readonly message: string;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
}> {}

export type ApiError =
  | BadRequest
  | NotFound
  | ReferenceMissing
  | UpstreamError
  | Schema.SchemaError;

export const UNAVAILABLE = "transit data is temporarily unavailable";

export const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status });

export const unavailable = () => json({ error: UNAVAILABLE }, 502);

export const noStore = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeader(response, "cache-control", CACHE.none);

export const respond = <A, R>(
  handler: Effect.Effect<A, ApiError, R>,
  cacheControl: string = CACHE.none,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  handler.pipe(
    Effect.map((body) =>
      HttpServerResponse.setHeader(json(body), "cache-control", cacheControl),
    ),
    Effect.catchDefect((defect) =>
      Effect.as(
        Effect.logError("unexpected failure", defect),
        json({ error: "internal error" }, 500),
      ),
    ),
    Effect.catch((error) => {
      switch (error._tag) {
        case "BadRequest":
          return Effect.succeed(json({ error: error.message }, 400));
        case "SchemaError":
          return Effect.succeed(
            json({ error: "invalid query parameters" }, 400),
          );
        case "NotFound":
          return Effect.succeed(json({ error: error.message }, 404));
        case "ReferenceMissing":
          return Effect.as(
            Effect.logWarning("reference data unavailable", error.message),
            unavailable(),
          );
        case "UpstreamError":
          return Effect.as(
            Effect.logWarning("upstream request failed", error.message),
            unavailable(),
          );
      }
    }),
    Effect.map((response) =>
      response.status >= 400 ? noStore(response) : response,
    ),
  );
