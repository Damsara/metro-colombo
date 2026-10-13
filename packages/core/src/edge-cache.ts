import { Clock, Effect, Option } from "effect";
import type { EdgeCacheShape } from "./ports.js";

export const makeMemoryEdgeCache = (capacity = 256) =>
  Effect.map(Clock.Clock, (clock): EdgeCacheShape => {
    const entries = new Map<
      string,
      { readonly body: Uint8Array; readonly until: number }
    >();
    return {
      get: (key) =>
        Effect.sync(() => {
          const entry = entries.get(key);
          if (!entry) return Option.none<Uint8Array>();
          if (clock.currentTimeMillisUnsafe() >= entry.until) {
            entries.delete(key);
            return Option.none<Uint8Array>();
          }
          return Option.some(entry.body.slice());
        }),
      put: (key, body, ttlSeconds) =>
        Effect.sync(() => {
          entries.delete(key);
          entries.set(key, {
            body: body.slice(),
            until: clock.currentTimeMillisUnsafe() + ttlSeconds * 1000,
          });
          while (entries.size > capacity)
            entries.delete(entries.keys().next().value!);
        }),
    };
  });
