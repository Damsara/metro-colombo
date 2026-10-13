import type { FleetObject } from "./fleet-object.js";

export type Env = {
  readonly ARCHIVE: R2Bucket;
  readonly ASSETS: Fetcher;
  readonly FLEET: DurableObjectNamespace<FleetObject>;
  readonly [name: string]: unknown;
};
