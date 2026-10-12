import { Effect, Layer, Option } from "effect";
import { HttpClient } from "effect/http";
import { ObjectStore, Scheduler, Socket, StateStore } from "@metro/core";
import { guardBucket, NodeConfig } from "./config.js";
import { fileObjectStore } from "./ports/file-object-store.js";
import { fileStateStore } from "./ports/file-state-store.js";
import { NodeTicker } from "./ports/node-ticker.js";
import { s3ObjectStore } from "./ports/s3-object-store.js";
import { wsSocket } from "./ports/ws-socket.js";

export const NodePorts = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* NodeConfig;
    const http = yield* HttpClient.HttpClient;
    const ticker = yield* NodeTicker;
    const s3 = Option.all({
      endpoint: config.s3Endpoint,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    });
    if (Option.isSome(s3)) yield* guardBucket(config.bucket);
    const objects = Option.match(s3, {
      onNone: () => fileObjectStore(config.dataDir),
      onSome: (settings) =>
        s3ObjectStore({ ...settings, bucket: config.bucket }, http),
    });
    return Layer.mergeAll(
      Layer.succeed(ObjectStore, objects),
      Layer.succeed(StateStore, fileStateStore(config.statePath)),
      Layer.succeed(Socket, wsSocket),
      Layer.succeed(Scheduler, ticker.scheduler),
    );
  }),
);
