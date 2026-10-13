import { Context, Data, type Effect, type Option } from "effect";

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string;
  readonly status?: number;
}> {}

export type StoredObject = {
  readonly body: Uint8Array;
  readonly contentType?: string;
  readonly cacheControl?: string;
};

export type PutOptions = {
  readonly contentType: string;
  readonly cacheControl?: string;
};

export type ObjectStoreShape = {
  readonly get: (
    key: string,
  ) => Effect.Effect<Option.Option<StoredObject>, StoreError>;
  readonly put: (
    key: string,
    body: Uint8Array,
    options: PutOptions,
  ) => Effect.Effect<void, StoreError>;
  readonly list: (
    prefix: string,
  ) => Effect.Effect<ReadonlyArray<string>, StoreError>;
  readonly delete: (key: string) => Effect.Effect<void, StoreError>;
};

export class ObjectStore extends Context.Service<
  ObjectStore,
  ObjectStoreShape
>()("metro/ObjectStore") {}

export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string;
}> {}

// Values must be JSON-compatible, with null rather than undefined, so every store keeps them alike.
export type StateStoreShape = {
  readonly get: (
    key: string,
  ) => Effect.Effect<Option.Option<unknown>, StateError>;
  readonly set: (
    key: string,
    value: unknown,
  ) => Effect.Effect<void, StateError>;
  readonly delete: (key: string) => Effect.Effect<void, StateError>;
};

export class StateStore extends Context.Service<StateStore, StateStoreShape>()(
  "metro/StateStore",
) {}

export class SocketError extends Data.TaggedError("SocketError")<{
  readonly message: string;
}> {}

export type SocketShape = {
  readonly connect: (
    url: string,
    headers: Readonly<Record<string, string>>,
    onText: (text: string) => void,
  ) => Effect.Effect<void, SocketError>;
};

export class Socket extends Context.Service<Socket, SocketShape>()(
  "metro/Socket",
) {}

export type SchedulerShape = {
  readonly wakeAfter: (ms: number) => Effect.Effect<void>;
  readonly next: Effect.Effect<Option.Option<number>>;
};

export class Scheduler extends Context.Service<Scheduler, SchedulerShape>()(
  "metro/Scheduler",
) {}

export type Alert = {
  readonly title: string;
  readonly message: string;
  readonly urgent?: boolean;
};

export type AlertsShape = {
  readonly send: (alert: Alert) => Effect.Effect<void>;
};

export class Alerts extends Context.Service<Alerts, AlertsShape>()(
  "metro/Alerts",
) {}

export type EdgeCacheShape = {
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>>;
  readonly put: (
    key: string,
    body: Uint8Array,
    ttlSeconds: number,
  ) => Effect.Effect<void>;
};

export class EdgeCache extends Context.Service<EdgeCache, EdgeCacheShape>()(
  "metro/EdgeCache",
) {}
