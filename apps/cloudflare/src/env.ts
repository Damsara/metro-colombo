import type { Compactor } from "./compactor.js";
import type { FleetObject } from "./fleet-object.js";

export type Env = {
  readonly ARCHIVE: R2Bucket;
  readonly ASSETS: Fetcher;
  readonly COMPACTOR: DurableObjectNamespace<Compactor>;
  readonly FLEET: DurableObjectNamespace<FleetObject>;
  readonly [name: string]: unknown;
};
