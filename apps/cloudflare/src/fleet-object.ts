import { DurableObject } from "cloudflare:workers";
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { ObjectStore, Scheduler, Socket, StateStore } from "@metro/core";
import { Fleet, type FleetShape, type FleetStatus, NtfyAlerts, type SubmitOutcome } from "@metro/fleet";
import { AuthClient, LiveFeedFromConfig } from "@metro/upstream";
import type { Env } from "./env.js";
import { alarmScheduler, doStateStore, r2ObjectStore, workerSocket } from "./ports.js";

export const stringVars = (env: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

export const fleetLayer = (env: Env, state: DurableObjectState) => {
  const ports = Layer.mergeAll(
    Layer.succeed(ObjectStore, r2ObjectStore(env.ARCHIVE)),
    Layer.succeed(StateStore, doStateStore(state.storage)),
    Layer.succeed(Scheduler, alarmScheduler(state.storage)),
    Layer.succeed(Socket, workerSocket),
  );
  const services = Layer.mergeAll(LiveFeedFromConfig, AuthClient.layer, NtfyAlerts).pipe(
    Layer.provideMerge(ports),
    Layer.provideMerge(FetchHttpClient.layer),
  );
  return Fleet.layer.pipe(
    Layer.provide(services),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(stringVars(env)))),
  );
};

const makeRuntime = (env: Env, state: DurableObjectState) => ManagedRuntime.make(fleetLayer(env, state));

export class FleetObject extends DurableObject<Env> {
  private readonly runtime: ReturnType<typeof makeRuntime>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.runtime = makeRuntime(env, state);
    void state.blockConcurrencyWhile(() => this.use((fleet) => fleet.start));
  }

  private use<A>(run: (fleet: FleetShape) => Effect.Effect<A>) {
    return this.runtime.runPromise(
      Effect.gen(function* () {
        return yield* run(yield* Fleet);
      }),
    );
  }

  async alarm() {
    await this.use((fleet) => fleet.tick);
  }

  async ensureRunning(): Promise<void> {
    await this.use((fleet) => fleet.start);
  }

  async status(): Promise<FleetStatus> {
    return this.use((fleet) => fleet.status);
  }

  async submitCode(code: string): Promise<SubmitOutcome> {
    return this.use((fleet) => fleet.submitCode(code));
  }
}
