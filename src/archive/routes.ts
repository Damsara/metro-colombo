import path from "node:path";
import { Clock, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ServerConfig } from "../config.js";
import { ArchiveStore } from "./r2.js";
import {
  catalogResponse,
  isDuckDbAgent,
  readme,
  todayResponse,
} from "./serve.js";

const unavailable = HttpServerResponse.text(
  "The fleet archive is unavailable right now.",
  { status: 502, headers: { "cache-control": "no-store" } },
);

const notConfigured = HttpServerResponse.text(
  "The fleet archive isn't set up on this server.",
  { status: 404, headers: { "cache-control": "no-store" } },
);

export const ArchiveRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const { webDist } = yield* ServerConfig;
    const index = path.join(path.resolve(webDist), "index.html");

    // DuckDB attaching the site's root gets the catalog; everyone else gets the app.
    const root = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!isDuckDbAgent(request.headers["user-agent"]))
        return yield* HttpServerResponse.file(index, {
          headers: { "cache-control": "no-cache" },
        });
      const store = yield* ArchiveStore;
      if (!store.enabled) return notConfigured;
      return yield* catalogResponse(store, {
        method: request.method,
        range: request.headers["range"],
        ifNoneMatch: request.headers["if-none-match"],
      }).pipe(
        Effect.map(HttpServerResponse.fromWeb),
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning("archive catalog unavailable", error),
            unavailable,
          ),
        ),
      );
    });

    const today = Effect.gen(function* () {
      const store = yield* ArchiveStore;
      if (!store.enabled) return notConfigured;
      return yield* todayResponse(store, yield* Clock.currentTimeMillis).pipe(
        Effect.map(HttpServerResponse.fromWeb),
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning("archive today feed unavailable", error),
            unavailable,
          ),
        ),
      );
    });

    const about = Effect.gen(function* () {
      const store = yield* ArchiveStore;
      if (!store.enabled) return notConfigured;
      return HttpServerResponse.text(readme(store.publicUrl), {
        headers: { "cache-control": "public, max-age=3600" },
      });
    });

    // DuckDB looks for a write-ahead log next to any database it attaches.
    const noLog = Effect.succeed(
      HttpServerResponse.empty({
        status: 404,
        headers: { "cache-control": "public, max-age=3600" },
      }),
    );

    return HttpRouter.addAll([
      HttpRouter.route("GET", "/", root),
      HttpRouter.route("HEAD", "/", root),
      HttpRouter.route("GET", "/.wal", noLog),
      HttpRouter.route("HEAD", "/.wal", noLog),
      HttpRouter.route("GET", "/data", about),
      HttpRouter.route("GET", "/data/today.ndjson.gz", today),
    ]);
  }),
);
