import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import {
  FleetClient,
  FleetRoutes,
  type FleetStatus,
  type SubmitOutcome,
} from "@metro/fleet";
import type { Env } from "./env.js";
import { stringVars } from "./fleet-object.js";

export { FleetObject } from "./fleet-object.js";

const fleetStub = (env: Env) => env.FLEET.get(env.FLEET.idFromName("fleet"));

const build = (env: Env) =>
  HttpRouter.toWebHandler(
    FleetRoutes.pipe(
      Layer.provide(
        Layer.succeed(
          FleetClient,
          FleetClient.of({
            status: Effect.promise(
              async () => (await fleetStub(env).status()) as FleetStatus,
            ),
            submitCode: (code) =>
              Effect.promise(
                async () =>
                  (await fleetStub(env).submitCode(code)) as SubmitOutcome,
              ),
            token: Effect.promise(() => fleetStub(env).sessionToken()).pipe(
              Effect.map((token) =>
                token === null
                  ? Option.none()
                  : Option.some(Redacted.make(token)),
              ),
            ),
          }),
        ),
      ),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromEnvRecord(stringVars(env))),
      ),
    ),
  );

let cached: ReturnType<typeof build> | undefined;

export default {
  fetch(request, env) {
    cached ??= build(env);
    return cached.handler(request);
  },
  async scheduled(_controller, env) {
    await fleetStub(env).ensureRunning();
  },
} satisfies ExportedHandler<Env>;
