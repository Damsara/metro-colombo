import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Fleet, FleetClient, FleetRoutes, NtfyAlerts } from "@metro/fleet";
import { AuthClient, LiveFeedFromConfig } from "@metro/upstream";
import { NodeConfig } from "./config.js";
import { NodePorts } from "./layers.js";
import { NodeTicker } from "./ports/node-ticker.js";

const Services = Layer.mergeAll(
  LiveFeedFromConfig,
  AuthClient.layer,
  NtfyAlerts,
).pipe(
  Layer.provideMerge(NodePorts),
  Layer.provideMerge(NodeTicker.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

const FleetLive = Fleet.layer.pipe(Layer.provideMerge(Services));

const Driver = Layer.effectDiscard(
  Effect.gen(function* () {
    const fleet = yield* Fleet;
    const ticker = yield* NodeTicker;
    yield* fleet.start;
    yield* Effect.forkScoped(ticker.drive(fleet.tick));
  }),
);

const Client = Layer.effect(
  FleetClient,
  Effect.gen(function* () {
    const fleet = yield* Fleet;
    return FleetClient.of({
      status: fleet.status,
      submitCode: fleet.submitCode,
    });
  }),
);

const HttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const { port, host } = yield* NodeConfig;
    return NodeHttpServer.layer(createServer, { port, host });
  }),
);

const Main = Layer.mergeAll(
  HttpRouter.serve(FleetRoutes).pipe(
    Layer.provide(Client),
    Layer.provide(HttpLive),
  ),
  Driver,
).pipe(Layer.provide(FleetLive));

Layer.launch(Main).pipe(NodeRuntime.runMain);
