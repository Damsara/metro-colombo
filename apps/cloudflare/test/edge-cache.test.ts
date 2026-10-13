import { test } from "vitest";
import { edgeCacheSuite } from "../../../packages/core/test/suites/edge-cache.suite.ts";
import { cacheApiEdgeCache } from "../src/ports.ts";

edgeCacheSuite(test, "cache api", (body) => body(cacheApiEdgeCache()));
