import { Context, Data, Effect, Layer, Option, Predicate, Redacted, Schema } from "effect";
import { HttpClient } from "effect/http";
import { Socket } from "@metro/core";
import { LankaMetroConfig } from "./config.js";

export class FeedError extends Data.TaggedError("FeedError")<{ readonly message: string }> {}

export type RouteCode = { readonly id: string; readonly code: string };

export type FeedHandlers = {
  readonly onMessage: () => void;
  readonly onBatch: (payload: ReadonlyArray<unknown>) => void;
};

export type LiveFeedShape = {
  readonly needsLogin: boolean;
  readonly run: (token: Option.Option<Redacted.Redacted<string>>, handlers: FeedHandlers) => Effect.Effect<void, FeedError>;
  readonly routes: (token: Option.Option<Redacted.Redacted<string>>) => Effect.Effect<ReadonlyArray<RouteCode>, FeedError>;
};

export class LiveFeed extends Context.Service<LiveFeed, LiveFeedShape>()("metro/LiveFeed") {}

export const LIVE_ORIGIN = "https://lmtgo.eimsky.com";

export const gpsPayload = (text: string): ReadonlyArray<unknown> | undefined => {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Predicate.isObject(frame) || (frame as { type?: unknown }).type !== "gps_update") return undefined;
  const payload = (frame as { payload?: unknown }).payload;
  return Array.isArray(payload) ? payload : undefined;
};

export const liveSocketUrl = (eimskyBase: string, token: string) => {
  const url = new URL("/ticketing-service/ws", eimskyBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
};

const RoutesResponse = Schema.Struct({
  data: Schema.Struct({ routes: Schema.Array(Schema.Struct({ id: Schema.String, code: Schema.String })) }),
});

export const LankaMetroFeed = Layer.effect(
  LiveFeed,
  Effect.gen(function* () {
    const { eimskyBase } = yield* LankaMetroConfig;
    const socket = yield* Socket;
    const http = yield* HttpClient.HttpClient;
    const noSession = Effect.fail(new FeedError({ message: "no upstream session" }));

    return LiveFeed.of({
      needsLogin: true,
      run: (token, handlers) =>
        Option.match(token, {
          onNone: () => noSession,
          onSome: (value) =>
            socket
              .connect(liveSocketUrl(eimskyBase, Redacted.value(value)), { origin: LIVE_ORIGIN }, (text) => {
                handlers.onMessage();
                const payload = gpsPayload(text);
                if (payload) handlers.onBatch(payload);
              })
              .pipe(Effect.mapError((error) => new FeedError({ message: error.message }))),
        }),
      routes: (token) =>
        Option.match(token, {
          onNone: () => noSession,
          onSome: (value) =>
            http
              .get(`${eimskyBase}/fare-service/api/v1/routes/geo`, {
                headers: { authorization: `Bearer ${Redacted.value(value)}` },
              })
              .pipe(
                Effect.mapError((error) => new FeedError({ message: `routes failed: ${error.message}` })),
                Effect.flatMap((response) =>
                  response.status === 200
                    ? response.json.pipe(
                        Effect.flatMap(Schema.decodeUnknownEffect(RoutesResponse)),
                        Effect.mapError((error) => new FeedError({ message: `routes failed: ${error.message}` })),
                      )
                    : Effect.andThen(
                        Effect.ignore(response.arrayBuffer),
                        Effect.fail(new FeedError({ message: `routes answered HTTP ${response.status}` })),
                      ),
                ),
                Effect.map(({ data }) => data.routes.map(({ id, code }) => ({ id, code }))),
              ),
        }),
    });
  }),
);
