import { type Config, Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { ObjectStore, Socket } from "@metro/core";
import { LiveFeedConfig, UpstreamKindConfig } from "./config.js";
import { LankaMetroReference } from "./lankametro-reference.js";
import { type FeedError, LankaMetroFeed, type LiveFeed } from "./live-feed.js";
import { ProxyUpstream } from "./proxy.js";
import type { ReferenceUpstream } from "./reference.js";
import { ReplayFeed } from "./replay.js";

type FeedLayer = Layer.Layer<
  LiveFeed,
  Config.ConfigError | FeedError,
  ObjectStore | Socket | HttpClient.HttpClient
>;

export const LiveFeedFromConfig: FeedLayer = Layer.unwrap(
  Effect.gen(function* () {
    const layer: FeedLayer =
      (yield* LiveFeedConfig) === "replay" ? ReplayFeed : LankaMetroFeed;
    return layer;
  }),
);

type ReferenceLayer = Layer.Layer<
  ReferenceUpstream,
  Config.ConfigError,
  HttpClient.HttpClient
>;

export const ReferenceUpstreamFromConfig: ReferenceLayer = Layer.unwrap(
  Effect.gen(function* () {
    const layer: ReferenceLayer =
      (yield* UpstreamKindConfig) === "proxy"
        ? ProxyUpstream
        : LankaMetroReference;
    return layer;
  }),
);
