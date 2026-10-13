import { ConfigProvider, Effect, Layer, Option } from "effect";
import { HttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import {
  EdgeCache,
  makeMemoryEdgeCache,
  ObjectStore,
  type ObjectStoreShape,
} from "@metro/core";
import {
  fakeHttpClient,
  manualClock,
  memoryObjectStore,
  spyObjectStore,
} from "@metro/core/testing";
import { FleetClient, type FleetClientShape } from "@metro/fleet";
import {
  ReferenceUpstream,
  type ReferenceUpstreamShape,
} from "@metro/upstream";
import { ReferenceReader, UiIndex, type UiIndexShape } from "@metro/api";
import { REFERENCE, T0 } from "./fixtures.ts";
import { seedReference } from "./seed.ts";

export type HarnessOptions = {
  readonly reference?: Readonly<Record<string, unknown>> | null;
  readonly upstream?: Partial<ReferenceUpstreamShape>;
  readonly client?: Partial<FleetClientShape>;
  readonly ui?: UiIndexShape;
  readonly http?: HttpClient.HttpClient;
  readonly env?: Readonly<Record<string, string>>;
  readonly at?: number;
  readonly wrapStore?: (inner: ObjectStoreShape) => ObjectStoreShape;
};

const unused = Effect.die("not used by this test");

export const harness = async (
  routes: Layer.Layer<never, unknown, unknown>,
  options: HarnessOptions = {},
) => {
  const time = manualClock(options.at ?? T0);
  const inner = memoryObjectStore();
  if (options.reference !== null)
    await Effect.runPromise(
      seedReference(inner, options.reference ?? REFERENCE),
    );
  const objects = spyObjectStore(options.wrapStore?.(inner) ?? inner);
  const upstream: ReferenceUpstreamShape = {
    needsLogin: false,
    routes: () => unused,
    stops: () => unused,
    geometry: () => unused,
    places: unused,
    occasions: unused,
    journey: () => unused,
    ...options.upstream,
  };
  const client = FleetClient.of({
    status: unused,
    submitCode: () => unused,
    token: Effect.succeed(Option.none()),
    ...options.client,
  });
  const ui =
    options.ui ??
    UiIndex.of({
      response: Effect.sync(() =>
        HttpServerResponse.text("<!doctype html><title>Metro</title>", {
          contentType: "text/html",
        }),
      ),
    });
  const deps = Layer.mergeAll(
    Layer.succeed(ObjectStore, objects.store),
    Layer.effect(EdgeCache, makeMemoryEdgeCache()),
    Layer.succeed(ReferenceUpstream, upstream),
    Layer.succeed(FleetClient, client),
    Layer.succeed(UiIndex, ui),
    Layer.succeed(
      HttpClient.HttpClient,
      options.http ?? fakeHttpClient(() => ({ status: 404 })).client,
    ),
    ConfigProvider.layer(
      ConfigProvider.fromEnvRecord({
        PUBLIC_DATA_URL: "https://data.example",
        ...options.env,
      }),
    ),
  ).pipe(Layer.provideMerge(time.layer));
  const app = (routes as Layer.Layer<never>).pipe(
    Layer.provide(ReferenceReader.layer),
    Layer.provide(deps),
  );
  const { handler } = HttpRouter.toWebHandler(app as never);
  const get = (path: string, init?: RequestInit) =>
    handler(new Request(`https://metro.test${path}`, init));
  return { handler, get, time, objects, upstream };
};
