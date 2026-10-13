import { createServer } from "node:http";
import path from "node:path";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schedule } from "effect";
import { FetchHttpClient, HttpRouter, HttpStaticServer } from "effect/http";
import { SiteRoutes } from "@metro/api";
import { EdgeCache, makeMemoryEdgeCache } from "@metro/core";
import { Fleet, FleetClient, NtfyAlerts } from "@metro/fleet";
import { ReferencePublisher } from "@metro/publisher";
import {
  AuthClient,
  LiveFeedFromConfig,
  ReferenceUpstreamFromConfig,
} from "@metro/upstream";
import { NodeConfig } from "./config.js";
import { NodePorts } from "./layers.js";
import { NodeTicker } from "./ports/node-ticker.js";
import { nodeUiIndex } from "./ui-index.js";

export const PUBLISH_CHECK_EVERY = "5 minutes";

const Services = Layer.mergeAll(
  LiveFeedFromConfig,
  AuthClient.layer,
  NtfyAlerts,
  ReferenceUpstreamFromConfig,
  Layer.effect(EdgeCache, makeMemoryEdgeCache()),
).pipe(
  Layer.provideMerge(NodePorts),
  Layer.provideMerge(NodeTicker.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

const FleetLive = ReferencePublisher.layer.pipe(
  Layer.provideMerge(Fleet.layer),
  Layer.provideMerge(Services),
);

const Driver = Layer.effectDiscard(
  Effect.gen(function* () {
    const fleet = yield* Fleet;
    const ticker = yield* NodeTicker;
    const publisher = yield* ReferencePublisher;
    yield* fleet.start;
    yield* Effect.forkScoped(ticker.drive(fleet.tick));
    yield* Effect.forkScoped(
      Effect.repeat(publisher.runIfDue, Schedule.spaced(PUBLISH_CHECK_EVERY)),
    );
  }),
);

const Client = Layer.effect(
  FleetClient,
  Effect.gen(function* () {
    const fleet = yield* Fleet;
    return FleetClient.of({
      status: fleet.status,
      submitCode: fleet.submitCode,
      token: fleet.token,
    });
  }),
);

const WebRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const root = path.resolve((yield* NodeConfig).webDist);
    return Layer.mergeAll(
      HttpStaticServer.layer({
        root: path.join(root, "assets"),
        prefix: "/assets",
        cacheControl: "public, max-age=31536000, immutable",
      }),
      HttpStaticServer.layer({ root, spa: true, cacheControl: "no-cache" }),
    );
  }),
);

const Ui = Layer.unwrap(
  Effect.map(NodeConfig, ({ webDist }) => nodeUiIndex(path.resolve(webDist))),
);

const HttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const { port, host } = yield* NodeConfig;
    return NodeHttpServer.layer(createServer, { port, host });
  }),
);

const Main = Layer.mergeAll(
  HttpRouter.serve(Layer.mergeAll(SiteRoutes, WebRoutes)).pipe(
    Layer.provide(Layer.mergeAll(Client, Ui)),
    Layer.provide(HttpLive),
  ),
  Driver,
).pipe(Layer.provide(FleetLive));

Layer.launch(Main).pipe(NodeRuntime.runMain);
