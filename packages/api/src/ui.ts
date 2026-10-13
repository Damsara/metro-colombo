import { Context, type Effect } from "effect";
import type { HttpServerResponse } from "effect/http";

export type UiIndexShape = {
  readonly response: Effect.Effect<HttpServerResponse.HttpServerResponse>;
};

export class UiIndex extends Context.Service<UiIndex, UiIndexShape>()(
  "metro/UiIndex",
) {}
