import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { fleetSuite } from "../../../packages/fleet/test/suites/fleet.suite.ts";
import { fileObjectStore } from "../src/ports/file-object-store.ts";
import { fileStateStore } from "../src/ports/file-state-store.ts";
import { makeNodeTicker } from "../src/ports/node-ticker.ts";

fleetSuite(test, "node", async (body) => {
  const dir = mkdtempSync(join(tmpdir(), "fleet-node-"));
  const ticker = await Effect.runPromise(makeNodeTicker);
  await body({
    objects: fileObjectStore(join(dir, "objects")),
    openState: () => fileStateStore(join(dir, "state.json")),
    scheduler: ticker.scheduler,
  });
});
