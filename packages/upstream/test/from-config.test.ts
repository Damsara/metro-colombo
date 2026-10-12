import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import { ObjectStore } from "@metro/core";
import { memoryObjectStore } from "@metro/core/testing";
import { LiveFeed, LiveFeedFromConfig } from "@metro/upstream";

const build = (env: Record<string, string>) =>
  Effect.runPromise(
    Effect.exit(
      Effect.gen(function* () {
        return (yield* LiveFeed).needsLogin;
      }).pipe(
        Effect.provide(
          LiveFeedFromConfig.pipe(
            Layer.provide(Layer.succeed(ObjectStore, memoryObjectStore())),
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
            ),
          ),
        ),
      ),
    ),
  );

test("a missing LIVE_FEED fails the layer", async () => {
  const exit = await build({});
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /LIVE_FEED/);
});

test("LIVE_FEED=replay selects the replay feed", async () => {
  const exit = await build({ LIVE_FEED: "replay", REPLAY_DATE: "2026-10-11" });
  assert.deepEqual(exit, Exit.succeed(false));
});
