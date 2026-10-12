import assert from "node:assert/strict";
import { test } from "node:test";
import {
  memoryObjectStore,
  memoryScheduler,
  memoryStateStore,
} from "@metro/core/testing";
import { reconnectDelay } from "@metro/fleet";
import { fleetSuite } from "./suites/fleet.suite.ts";

fleetSuite(test, "memory", (body) => {
  const backing = new Map<string, string>();
  return body({
    objects: memoryObjectStore(),
    openState: () => memoryStateStore(backing),
    scheduler: memoryScheduler(),
  });
});

test("reconnect delays double from 2 s and stop at 60 s", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map(reconnectDelay),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000],
  );
});
