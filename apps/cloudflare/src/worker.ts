import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import { SiteRoutes, UiIndex } from "@metro/api";
import { EdgeCache, ObjectStore } from "@metro/core";
import {
  FleetClient,
  type FleetStatus,
  type SubmitOutcome,
} from "@metro/fleet";
import { ReferenceUpstreamFromConfig } from "@metro/upstream";
import type { Env } from "./env.js";
import { stringVars } from "./fleet-object.js";
import { cacheApiEdgeCache, r2ObjectStore } from "./ports.js";

export { FleetObject } from "./fleet-object.js";

const fleetStub = (env: Env) => env.FLEET.get(env.FLEET.idFromName("fleet"));

const fleetClient = (env: Env) =>
  FleetClient.of({
    status: Effect.promise(
      async () => (await fleetStub(env).status()) as FleetStatus,
    ),
    submitCode: (code) =>
      Effect.promise(
        async () => (await fleetStub(env).submitCode(code)) as SubmitOutcome,
      ),
    token: Effect.promise(() => fleetStub(env).sessionToken()).pipe(
      Effect.map((token) =>
        token === null ? Option.none() : Option.some(Redacted.make(token)),
      ),
    ),
  });

const assetsIndex = (env: Env) =>
  UiIndex.of({
    response: Effect.promise(async () => {
      const page = await env.ASSETS.fetch(
        new Request("https://assets.invalid/"),
      );
      const html = await page.text();
      return page.ok
        ? HttpServerResponse.text(html, { contentType: "text/html" })
        : HttpServerResponse.text("The web app isn't deployed.", {
            status: 404,
            headers: { "cache-control": "no-store" },
          });
    }),
  });

export const siteLayer = (env: Env) =>
  SiteRoutes.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(FleetClient, fleetClient(env)),
        Layer.succeed(UiIndex, assetsIndex(env)),
        Layer.succeed(ObjectStore, r2ObjectStore(env.ARCHIVE)),
        Layer.succeed(EdgeCache, cacheApiEdgeCache()),
        ReferenceUpstreamFromConfig.pipe(
          Layer.provideMerge(FetchHttpClient.layer),
        ),
      ),
    ),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromEnvRecord(stringVars(env))),
    ),
  );

export const makeSite = (env: Env) => HttpRouter.toWebHandler(siteLayer(env));

let site: ReturnType<typeof makeSite> | undefined;

export default {
  fetch(request, env) {
    site ??= makeSite(env);
    return site.handler(request);
  },
  async scheduled(_controller, env) {
    const stub = fleetStub(env);
    await Promise.all([stub.ensureRunning(), stub.publishReferenceIfDue()]);
  },
} satisfies ExportedHandler<Env>;
