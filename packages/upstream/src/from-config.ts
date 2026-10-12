import { type Config, Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { ObjectStore, Socket } from "@metro/core";
import { LiveFeedConfig } from "./config.js";
import { type FeedError, LankaMetroFeed, type LiveFeed } from "./live-feed.js";
import { ReplayFeed } from "./replay.js";

type FeedLayer = Layer.Layer<LiveFeed, Config.ConfigError | FeedError, ObjectStore | Socket | HttpClient.HttpClient>;

export const LiveFeedFromConfig: FeedLayer = Layer.unwrap(
  Effect.gen(function* () {
    const layer: FeedLayer = (yield* LiveFeedConfig) === "replay" ? ReplayFeed : LankaMetroFeed;
    return layer;
  }),
);
