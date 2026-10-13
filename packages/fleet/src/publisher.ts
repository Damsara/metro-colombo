import { Effect, Option, Schema } from "effect";
import {
  encodeVehiclePositions,
  type Fix,
  type ObjectStoreShape,
  parseJson,
  S,
} from "@metro/core";
import type { RouteCode } from "@metro/upstream";
import {
  liveDocument,
  type LiveDocument,
  type StaleReason,
} from "./snapshot.js";

export const LIVE_JSON_KEY = "live/live.json";
export const VEHICLES_PB_KEY = "live/vehicles.pb";
export const LIVE_CACHE = "public, max-age=5";
export const REPUBLISH_EVERY_MS = 60_000;

export type PublishInput = {
  readonly now: number;
  readonly fixes: ReadonlyArray<Fix>;
  readonly routes: ReadonlyArray<RouteCode>;
  readonly lastBatchAt: number;
  readonly reason: StaleReason | undefined;
};

export const makeLivePublisher = (store: ObjectStoreShape) =>
  Effect.sync(() => {
    let frozen: ReadonlyArray<S.LiveBus> = [];
    let frozenAt = 0;
    let lastKey = "";
    let lastWriteAt = Number.NEGATIVE_INFINITY;
    const utf8 = new TextEncoder();

    const restore = store.get(LIVE_JSON_KEY).pipe(
      Effect.map(
        Option.flatMap((object) =>
          parseJson(new TextDecoder().decode(object.body)),
        ),
      ),
      Effect.map(Option.flatMap(Schema.decodeUnknownOption(S.LiveFeed))),
      Effect.map(
        Option.map((previous) => {
          frozen = previous.buses;
          frozenAt = previous.timestamp;
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("previous live snapshot unreadable", error.message),
      ),
      Effect.asVoid,
    );

    const current = (input: PublishInput): LiveDocument =>
      liveDocument({ ...input, frozen, frozenAt });

    const publish = (input: PublishInput) =>
      Effect.gen(function* () {
        const doc = current(input);
        if (!doc.stale && doc.buses.length) {
          frozen = doc.buses;
          frozenAt = doc.timestamp;
        }
        const key = JSON.stringify([
          doc.buses.length ? doc.timestamp : null,
          doc.stale,
          doc.reason ?? null,
          doc.buses,
        ]);
        if (key === lastKey && input.now - lastWriteAt < REPUBLISH_EVERY_MS)
          return;
        const seconds = Math.floor((doc.timestamp || input.now) / 1000);
        yield* store.put(LIVE_JSON_KEY, utf8.encode(JSON.stringify(doc)), {
          contentType: "application/json",
          cacheControl: LIVE_CACHE,
        });
        yield* store.put(
          VEHICLES_PB_KEY,
          encodeVehiclePositions(doc.buses, seconds),
          {
            contentType: "application/x-protobuf",
            cacheControl: LIVE_CACHE,
          },
        );
        lastKey = key;
        lastWriteAt = input.now;
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("live publish failed", error.message),
        ),
      );

    return { restore, publish, current };
  });
