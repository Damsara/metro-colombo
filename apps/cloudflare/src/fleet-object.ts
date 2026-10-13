import { DurableObject } from "cloudflare:workers";
import {
  ConfigProvider,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { ObjectStore, Scheduler, Socket, StateStore } from "@metro/core";
import {
  Fleet,
  type FleetShape,
  type FleetStatus,
  type LiveDocument,
  NtfyAlerts,
  type SubmitOutcome,
} from "@metro/fleet";
import {
  type PublishReport,
  ReferencePublisher,
  type ReferencePublisherShape,
} from "@metro/publisher";
import {
  AuthClient,
  LiveFeedFromConfig,
  ReferenceUpstreamFromConfig,
} from "@metro/upstream";
import type { Env } from "./env.js";
import {
  alarmScheduler,
  doStateStore,
  r2ObjectStore,
  workerSocket,
} from "./ports.js";

export const stringVars = (env: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export const fleetLayer = (env: Env, state: DurableObjectState) => {
  const ports = Layer.mergeAll(
    Layer.succeed(ObjectStore, r2ObjectStore(env.ARCHIVE)),
    Layer.succeed(StateStore, doStateStore(state.storage)),
    Layer.succeed(Scheduler, alarmScheduler(state.storage)),
    Layer.succeed(Socket, workerSocket),
  );
  const services = Layer.mergeAll(
    LiveFeedFromConfig,
    AuthClient.layer,
    NtfyAlerts,
    ReferenceUpstreamFromConfig,
  ).pipe(Layer.provideMerge(ports), Layer.provideMerge(FetchHttpClient.layer));
  return ReferencePublisher.layer.pipe(
    Layer.provideMerge(Fleet.layer),
    Layer.provide(services),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromEnvRecord(stringVars(env))),
    ),
  );
};

const makeRuntime = (env: Env, state: DurableObjectState) =>
  ManagedRuntime.make(fleetLayer(env, state));

const PUBLISH_CHECK_MS = 5 * 60_000;

export class FleetObject extends DurableObject<Env> {
  private readonly runtime: ReturnType<typeof makeRuntime>;
  private publishCheckedAt = 0;
  publishing: Promise<PublishReport | null> | undefined;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.runtime = makeRuntime(env, state);
    void state.blockConcurrencyWhile(() => this.use((fleet) => fleet.start));
  }

  private use<A>(
    run: (
      fleet: FleetShape,
      publisher: ReferencePublisherShape,
    ) => Effect.Effect<A>,
  ) {
    return this.runtime.runPromise(
      Effect.gen(function* () {
        return yield* run(yield* Fleet, yield* ReferencePublisher);
      }),
    );
  }

  async alarm() {
    await this.use((fleet) => fleet.tick);
    const now = Date.now();
    // The cron is not a reliable trigger, so the Fleet's own alarm also checks whether a publish is due.
    if (now - this.publishCheckedAt >= PUBLISH_CHECK_MS) {
      this.publishCheckedAt = now;
      this.publishing = this.publishReferenceIfDue();
      this.ctx.waitUntil(this.publishing);
    }
  }

  async ensureRunning(): Promise<void> {
    await this.use((fleet) => fleet.start);
  }

  async status(): Promise<FleetStatus> {
    return this.use((fleet) => fleet.status);
  }

  async live(): Promise<LiveDocument> {
    return this.use((fleet) => fleet.live);
  }

  async submitCode(code: string): Promise<SubmitOutcome> {
    return this.use((fleet) => fleet.submitCode(code));
  }

  async publishReferenceIfDue(): Promise<PublishReport | null> {
    return this.use((_fleet, publisher) =>
      Effect.map(publisher.runIfDue, Option.getOrNull),
    );
  }

  async sessionToken(): Promise<string | null> {
    return this.use((fleet) =>
      Effect.map(fleet.token, (token) =>
        Option.match(token, { onNone: () => null, onSome: Redacted.value }),
      ),
    );
  }
}
