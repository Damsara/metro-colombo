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
} from "effect";
import { WebSocket } from "ws";
import { UpstreamConfig } from "./config.js";
import type * as S from "./schemas.js";
import { UpstreamApi } from "./upstream.js";

const STALE_AFTER = Duration.seconds(60);
// The feed chats every few seconds. If it goes quiet for longer than this,
// assume the line is dead and dial again.
const SILENT_AFTER = Duration.seconds(30);
const WATCHDOG_EVERY_MS = 5_000;

const NETWORK_MAX_LAT = 7.2;
const NETWORK_MAX_LNG = 80.4;

class LiveFeedClosed extends Data.TaggedError("LiveFeedClosed")<{
  readonly receivedData: boolean;
}> {}

type Fix = S.LiveBus & { readonly receivedAt: number };

const finite = (value: unknown): number | undefined =>
  Predicate.isNumber(value) && Number.isFinite(value) ? value : undefined;
const nonEmpty = (value: unknown): string | undefined =>
  Predicate.isString(value) && value.length > 0 ? value : undefined;

const OPTIONAL_TEXT = [
  "route_code",
  "route_id",
  "direction_id",
  "registration_number",
] as const;
const OPTIONAL_NUMBERS = [
  "heading",
  "current_capacity",
  "total_capacity",
  "timestamp",
] as const;

// Keep only known fields. Upstream frames are never forwarded verbatim.
export function toFix(input: unknown, receivedAt: number): Fix | undefined {
  if (!Predicate.isObject(input)) return undefined;
  const bus = input as Record<string, unknown>;
  const id = nonEmpty(bus.bus_id) ?? nonEmpty(bus.id);
  let lat = finite(bus.lat) ?? finite(bus.latitude);
  let lng = finite(bus.lng) ?? finite(bus.longitude);
  if (!id || lat === undefined || lng === undefined) return undefined;
  // Some fixes arrive exactly one degree north and east of the truth, which
  // would put a Colombo bus somewhere around Polonnaruwa. The real network
  // sits below 7.2 N and west of 80.4 E, so those get moved back.
  if (lat > NETWORK_MAX_LAT || lng > NETWORK_MAX_LNG) {
    lat -= 1;
    lng -= 1;
  }
  const fix: { -readonly [K in keyof Fix]: Fix[K] } = {
    id,
    lat,
    lng,
    receivedAt,
  };
  for (const key of OPTIONAL_TEXT) {
    const value = nonEmpty(bus[key]);
    if (value !== undefined) fix[key] = value;
  }
  for (const key of OPTIONAL_NUMBERS) {
    const value = finite(bus[key]);
    if (value !== undefined) fix[key] = value;
  }
  return fix;
}

// The positions in a `gps_update` text frame, or undefined for anything else.
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
  { readonly snapshot: Effect.Effect<S.LiveFeed> }
>()("lmt-go/LiveFleet") {
  static readonly layer = Layer.effect(
    LiveFleet,
    Effect.gen(function* () {
      const config = yield* UpstreamConfig;
      const clock = yield* Clock.Clock;
      const upstream = yield* UpstreamApi;
      const fixes = new Map<string, Fix>();
      let lastUpdate = 0;
      let connected = false;

      const url = new URL("/ticketing-service/ws", config.eimskyBase);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", Redacted.value(config.token));

      // Returns whether the message carried position data.
      const onMessage = (
        bytes: WebSocket.RawData,
        isBinary: boolean,
      ): boolean => {
        const payload = gpsPayload(bytes, isBinary);
        if (!payload) return false;
        const receivedAt = clock.currentTimeMillisUnsafe();
        for (const value of payload) {
          const fix = toFix(value, receivedAt);
          if (fix) fixes.set(fix.id, fix);
        }
        lastUpdate = receivedAt;
        return true;
      };

      // One connection's lifetime. It ends when the socket closes, noting
      // whether any positions arrived. Only a session that actually delivered
      // data resets the reconnect backoff, so an upstream that keeps picking
      // up and hanging up on us isn't redialled in a tight loop.
      const session = Effect.callback<never, LiveFeedClosed>((resume) => {
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

      // `success` says whether we're connected. Connected with an empty
      // `buses` list just means nobody is out right now (try 2am).
      const snapshot = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        // The feed identifies routes by id; add the public route code.
        const routes = yield* upstream.routes.pipe(
          Effect.orElseSucceed(() => []),
        );
        const routeCodes = new Map(
          routes.map((route) => [route.id, route.code]),
        );
        const buses: S.LiveBus[] = [];
        for (const [id, { receivedAt, ...bus }] of fixes) {
          if (now - receivedAt > Duration.toMillis(STALE_AFTER)) {
            fixes.delete(id);
            continue;
          }
          const route_code =
            bus.route_code ?? (bus.route_id && routeCodes.get(bus.route_id));
          buses.push(route_code ? { ...bus, route_code } : bus);
        }
        return {
          success: connected,
          count: buses.length,
          timestamp: lastUpdate,
          // Age by the server's clock, so clients can time their next poll
          // without trusting a phone clock that may be minutes off.
          ...(lastUpdate ? { age_ms: Math.max(0, now - lastUpdate) } : {}),
          buses,
        };
      });

      return LiveFleet.of({ snapshot });
    }),
  );
}
