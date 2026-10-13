import { Context, Data, type Effect, type Option, type Redacted } from "effect";
import type { Occasion, S } from "@metro/core";

export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
  readonly status?: number;
  readonly detail?: string;
}> {}

export type Token = Option.Option<Redacted.Redacted<string>>;

export type ReferenceUpstreamShape = {
  readonly needsLogin: boolean;
  readonly routes: (
    token: Token,
  ) => Effect.Effect<ReadonlyArray<S.Route>, UpstreamError>;
  readonly stops: (
    token: Token,
    route: S.Route,
    direction: S.Direction,
  ) => Effect.Effect<ReadonlyArray<S.Stop>, UpstreamError>;
  readonly geometry: (
    token: Token,
    route: S.Route,
    direction: S.Direction,
  ) => Effect.Effect<unknown, UpstreamError>;
  readonly places: Effect.Effect<ReadonlyArray<S.Place>, UpstreamError>;
  readonly occasions: Effect.Effect<ReadonlyArray<Occasion>, UpstreamError>;
  readonly journey: (
    token: Token,
    fromStopId: string,
    toStopId: string,
    date: string,
  ) => Effect.Effect<S.JourneyPlan, UpstreamError>;
};

export class ReferenceUpstream extends Context.Service<
  ReferenceUpstream,
  ReferenceUpstreamShape
>()("metro/ReferenceUpstream") {}
