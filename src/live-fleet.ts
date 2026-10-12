import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Predicate,
  Redacted,
  Schedule,
  PubSub,
  Scope,
} from "effect";
import { WebSocket } from "ws";
import { Auth } from "./auth.js";
import { UpstreamConfig } from "./config.js";
import { type Fix, type S, toFix, withRouteCodes } from "@metro/core";
import { UpstreamApi } from "./upstream.js";

const STALE_AFTER = Duration.seconds(60);
// The feed chats every few seconds, so a longer silence means the line is dead.
const SILENT_AFTER = Duration.seconds(30);
const WATCHDOG_EVERY_MS = 5_000;

class LiveFeedClosed extends Data.TaggedError("LiveFeedClosed")<{
  readonly receivedData: boolean;
}> {}

// About an hour of fixes; the archive takes them every few minutes.
const MAX_RECORDED_FIXES = 100_000;

const gpsPayload = (
  bytes: WebSocket.RawData,
  isBinary: boolean,
): ReadonlyArray<unknown> | undefined => {
  if (isBinary) return undefined;
  let frame: unknown;
  try {
    frame = JSON.parse(bytes.toString());
  } catch {
    return undefined;
  }
  if (
    !Predicate.isObject(frame) ||
    (frame as { type?: unknown }).type !== "gps_update"
  ) {
    return undefined;
  }
  const payload = (frame as { payload?: unknown }).payload;
  return Array.isArray(payload) ? payload : undefined;
};

export class LiveFleet extends Context.Service<
  LiveFleet,
  {
    readonly snapshot: Effect.Effect<S.LiveFeed>;
    // Every accepted fix, for whoever subscribes; nothing is kept without a subscriber.
    readonly subscribeFixes: Effect.Effect<
      PubSub.Subscription<Fix>,
      never,
      Scope.Scope
    >;
  }
>()("lmt-go/LiveFleet") {
  static readonly layer = Layer.effect(
    LiveFleet,
    Effect.gen(function* () {
      const config = yield* UpstreamConfig;
      const clock = yield* Clock.Clock;
      const upstream = yield* UpstreamApi;
      const auth = yield* Auth;
      const fixes = new Map<string, Fix>();
      const recorded = yield* PubSub.sliding<Fix>(MAX_RECORDED_FIXES);
      let lastUpdate = 0;
      let connected = false;

      const onMessage = (
        bytes: WebSocket.RawData,
        isBinary: boolean,
      ): boolean => {
        const payload = gpsPayload(bytes, isBinary);
        if (!payload) return false;
        const receivedAt = clock.currentTimeMillisUnsafe();
        for (const value of payload) {
          const fix = toFix(value, receivedAt);
          if (fix) {
            fixes.set(fix.id, fix);
            PubSub.publishUnsafe(recorded, fix);
          }
        }
        lastUpdate = receivedAt;
        return true;
      };

      // Only a session that delivered data resets the reconnect backoff, so an upstream that keeps hanging up isn't redialled in a tight loop.
      const session = Effect.gen(function* () {
        // A failed token fetch counts as a dropped session so the backoff applies.
        const token = yield* auth.currentToken.pipe(
          Effect.catch(() =>
            Effect.fail(new LiveFeedClosed({ receivedData: false })),
          ),
        );
        const url = new URL("/ticketing-service/ws", config.eimskyBase);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", Redacted.value(token));

        yield* Effect.callback<never, LiveFeedClosed>((resume) => {
          let receivedData = false;
          let lastMessage = clock.currentTimeMillisUnsafe();
          const socket = new WebSocket(url, {
            headers: { origin: "https://lmtgo.eimsky.com" },
            handshakeTimeout: 15_000,
            maxPayload: 2 * 1024 * 1024,
            followRedirects: false,
          });
          const watchdog = setInterval(() => {
            if (
              clock.currentTimeMillisUnsafe() - lastMessage >
              Duration.toMillis(SILENT_AFTER)
            ) {
              socket.terminate();
            }
          }, WATCHDOG_EVERY_MS);
          socket.on("message", (bytes, isBinary) => {
            lastMessage = clock.currentTimeMillisUnsafe();
            if (onMessage(bytes, isBinary)) receivedData = connected = true;
          });
          // 'close' always follows 'error'.
          socket.on("error", () => {});
          socket.on("close", () => {
            clearInterval(watchdog);
            connected = false;
            resume(Effect.fail(new LiveFeedClosed({ receivedData })));
          });
          return Effect.sync(() => {
            clearInterval(watchdog);
            socket.terminate();
          });
        });
      });

      const reconnect = Schedule.min([
        Schedule.exponential(Duration.seconds(1)),
        Schedule.spaced(Duration.seconds(30)),
      ]);

      yield* session.pipe(
        Effect.catchIf(
          (closed) => closed.receivedData,
          () => Effect.sleep(Duration.seconds(1)),
        ),
        Effect.retry(reconnect),
        Effect.forever,
        Effect.forkScoped,
      );

      // Connected with an empty `buses` list just means nobody is out right now.
      const snapshot = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const routes = yield* upstream.routes.pipe(
          Effect.orElseSucceed(() => []),
        );
        const fresh: Array<Omit<Fix, "receivedAt">> = [];
        for (const [id, { receivedAt, ...bus }] of fixes) {
          if (now - receivedAt > Duration.toMillis(STALE_AFTER)) {
            fixes.delete(id);
            continue;
          }
          fresh.push(bus);
        }
        const buses = withRouteCodes(fresh, routes);
        return {
          success: connected,
          count: buses.length,
          timestamp: lastUpdate,
          // Aged by the server's clock so clients needn't trust a phone clock that may be minutes off.
          ...(lastUpdate ? { age_ms: Math.max(0, now - lastUpdate) } : {}),
          buses,
        };
      });

      return LiveFleet.of({
        snapshot,
        subscribeFixes: PubSub.subscribe(recorded),
      });
    }),
  );
}
