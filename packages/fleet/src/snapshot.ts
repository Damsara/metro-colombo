import { type Fix, type S, withRouteCodes } from "@metro/core";
import type { RouteCode } from "@metro/upstream";

export const FRESH_FIX_MS = 60_000;
export const FEED_QUIET_MS = 120_000;

export type StaleReason = "login_needed" | "feed_down";

export type LiveDocument = S.LiveFeed & { readonly stale: boolean; readonly reason?: StaleReason };

const withoutReceivedAt = (fix: Fix): S.LiveBus => {
  const { receivedAt, ...bus } = fix;
  void receivedAt;
  return bus;
};

export function liveDocument(input: {
  readonly now: number;
  readonly fixes: ReadonlyArray<Fix>;
  readonly routes: ReadonlyArray<RouteCode>;
  readonly lastBatchAt: number;
  readonly frozen: ReadonlyArray<S.LiveBus>;
  readonly reason: StaleReason | undefined;
}): LiveDocument {
  const { now, lastBatchAt, reason } = input;
  const buses = reason
    ? [...input.frozen]
    : withRouteCodes(
        input.fixes.filter((fix) => now - fix.receivedAt <= FRESH_FIX_MS).map(withoutReceivedAt),
        input.routes,
      );
  return {
    success: !reason && lastBatchAt > 0,
    count: buses.length,
    timestamp: lastBatchAt,
    ...(lastBatchAt ? { age_ms: Math.max(0, now - lastBatchAt) } : {}),
    buses,
    stale: reason !== undefined,
    ...(reason ? { reason } : {}),
  };
}

export const staleReason = (input: {
  readonly now: number;
  readonly lastBatchAt: number;
  readonly loginNeeded: boolean;
}): StaleReason | undefined =>
  input.now - input.lastBatchAt <= FEED_QUIET_MS ? undefined : input.loginNeeded ? "login_needed" : "feed_down";
