import { Config, ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

const Payload = Schema.Struct({ code: Schema.String });

const handle = (input: unknown) =>
  Effect.gen(function* () {
    const greeting = yield* Config.String("GREETING");
    const decoded = yield* Schema.decodeUnknownEffect(Payload)(input);
    return HttpServerResponse.jsonUnsafe({ greeting, decoded });
  });

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/check", handle({ code: "CM01" })),
  HttpRouter.add("GET", "/bad", handle({ code: 1 })),
  HttpRouter.add(
    "GET",
    "/missing",
    Config.String("NOPE").pipe(Effect.map((value) => HttpServerResponse.jsonUnsafe({ value }))),
  ),
);

const build = (env: Record<string, string>) =>
  HttpRouter.toWebHandler(
    routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)))),
  );

let cached: ReturnType<typeof build> | undefined;

export default {
  fetch(request: Request, env: Record<string, string>) {
    cached ??= build(env);
    return cached.handler(request);
  },
};
