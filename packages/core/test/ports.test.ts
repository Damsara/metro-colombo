import { test } from "node:test";
import {
  memoryObjectStore,
  memoryScheduler,
  memoryStateStore,
} from "@metro/core/testing";
import { clockSuite } from "./suites/clock.suite.ts";
import { objectStoreSuite } from "./suites/object-store.suite.ts";
import { schedulerSuite } from "./suites/scheduler.suite.ts";
import { stateStoreSuite } from "./suites/state-store.suite.ts";

objectStoreSuite(test, "memory", (body) => body(memoryObjectStore()));
stateStoreSuite(test, "memory", (body) => {
  const backing = new Map<string, string>();
  return body(() => memoryStateStore(backing));
});
schedulerSuite(test, "memory", (body) => body(memoryScheduler()));
clockSuite(test, "effect");
