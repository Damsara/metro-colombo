import { Cause, Clock, Data, Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { ApiConfig } from "./config.js";
import { UiIndex } from "./ui.js";

export const CATALOG_PATH = "catalog/metro.duckdb";
export const CATALOG_TIMEOUT_MS = 20_000;
export const UI_TIMEOUT_MS = 10_000;

const PASSED_THROUGH = [
  "content-length",
  "content-range",
  "etag",
  "last-modified",
] as const;

export const isDuckDbAgent = (userAgent: string | undefined) =>
  userAgent !== undefined && /^(duckdb\/|cpp-httplib\/)/i.test(userAgent);

class CatalogUnavailable extends Data.TaggedError("CatalogUnavailable")<{
  readonly status: number;
}> {}

const appUnavailable = () =>
  HttpServerResponse.text("The app is unavailable right now.", {
    status: 502,
    headers: { "cache-control": "no-store" },
  });

const unavailable = () =>
  HttpServerResponse.text("The fleet archive is unavailable right now.", {
    status: 502,
    headers: { "cache-control": "no-store" },
  });

export const makeCatalogRoutes = (timeoutMs = CATALOG_TIMEOUT_MS) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { publicDataUrl } = yield* ApiConfig;
      const http = yield* HttpClient.HttpClient;
      const ui = yield* UiIndex;
      const clock = yield* Clock.Clock;
      const url = `${publicDataUrl.replace(/\/+$/, "")}/${CATALOG_PATH}`;

      const fetchCatalog = (
        method: "GET" | "HEAD",
        headers: Record<string, string>,
      ) =>
        http
          .execute(
            method === "HEAD"
              ? HttpClientRequest.head(url, { headers })
              : HttpClientRequest.get(url, { headers }),
          )
          .pipe(
            Effect.flatMap((response) =>
              response.status >= 500
                ? Effect.andThen(
                    Effect.ignore(response.arrayBuffer),
                    Effect.fail(
                      new CatalogUnavailable({ status: response.status }),
                    ),
                  )
                : Effect.succeed(response),
            ),
            Effect.timeout(timeoutMs),
            Effect.retry({ times: 1 }),
            Effect.provideService(Clock.Clock, clock),
          );

      const browser = ui.response.pipe(
        Effect.timeout(UI_TIMEOUT_MS),
        Effect.provideService(Clock.Clock, clock),
        Effect.map((response) =>
          response.status >= 200 && response.status < 300
            ? HttpServerResponse.setHeaders(response, {
                "cache-control": "no-cache",
                vary: "User-Agent",
              })
            : response,
        ),
        Effect.catchCause((cause) =>
          Effect.as(
            Effect.logWarning("app index unavailable", Cause.squash(cause)),
            appUnavailable(),
          ),
        ),
      );

      const root = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!isDuckDbAgent(request.headers["user-agent"]))
          return yield* browser;
        const method = request.method === "HEAD" ? "HEAD" : "GET";
        const forwarded: Record<string, string> = {};
        for (const name of ["range", "if-none-match"] as const) {
          const value = request.headers[name];
          if (value) forwarded[name] = value;
        }
        return yield* fetchCatalog(method, forwarded).pipe(
          Effect.map((response) => {
            const headers: Record<string, string> = {
              "accept-ranges": "bytes",
              // The root answers browsers and DuckDB differently, so a shared cache must not keep it.
              "cache-control": "private, max-age=300",
              vary: "User-Agent",
            };
            for (const name of PASSED_THROUGH) {
              const value = response.headers[name];
              if (value !== undefined) headers[name] = value;
            }
            const options = {
              status: response.status,
              headers,
              contentType: "application/octet-stream",
            };
            return method === "HEAD"
              ? HttpServerResponse.empty(options)
              : HttpServerResponse.stream(response.stream, options);
          }),
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("archive catalog unavailable", error._tag),
              unavailable(),
            ),
          ),
        );
      });

      const noLog = Effect.sync(() =>
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
      ]);
    }),
  );

export const CatalogRoutes = makeCatalogRoutes();
