import type { FleetObject } from "./fleet-object.js";

export type Env = {
  readonly ARCHIVE: R2Bucket;
  readonly FLEET: DurableObjectNamespace<FleetObject>;
  readonly [name: string]: unknown;
};
