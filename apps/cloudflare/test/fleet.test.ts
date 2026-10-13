import { runInDurableObject } from "cloudflare:test";
import { test } from "vitest";
import { fleetSuite } from "../../../packages/fleet/test/suites/fleet.suite.ts";
import { alarmScheduler, doStateStore, r2ObjectStore } from "../src/ports.ts";
import { emptyArchive, probe, testEnv } from "./env.ts";

fleetSuite(test, "cloudflare", async (body) => {
  await emptyArchive();
  await runInDurableObject(probe(), (_instance, state) =>
    body({
      objects: r2ObjectStore(testEnv.ARCHIVE),
      openState: () => doStateStore(state.storage),
      scheduler: alarmScheduler(state.storage),
    }),
  );
});
