import { runInDurableObject } from "cloudflare:test";
import { test } from "vitest";
import { fleetSuite } from "../../../packages/fleet/test/suites/fleet.suite.ts";
import { alarmScheduler, doStateStore, r2ObjectStore } from "../src/ports.ts";
import { probe, testEnv } from "./env.ts";

// R2 is shared by every test in a file, and the suite expects each test to start with an empty store.
const emptyArchive = async () => {
  for (
    let listed = await testEnv.ARCHIVE.list();
    listed.objects.length > 0;
    listed = await testEnv.ARCHIVE.list()
  ) {
    await testEnv.ARCHIVE.delete(listed.objects.map((object) => object.key));
  }
};

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
