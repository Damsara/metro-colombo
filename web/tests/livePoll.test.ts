import assert from "node:assert/strict";
import { test } from "vitest";
import { nextLivePoll } from "../src/api";
import type { LiveFeed } from "../src/types";

const feed = (age_ms?: number, success = true): LiveFeed => ({
  success,
  timestamp: 1,
  ...(age_ms === undefined ? {} : { age_ms }),
  buses: [],
});

test("polls just after the next upstream update", () => {
  assert.equal(nextLivePoll(feed(0)), 5400);
  assert.equal(nextLivePoll(feed(1200)), 4200);
  assert.equal(nextLivePoll(feed(4500)), 1000);
});

test("retries shortly when an update is late", () => {
  assert.equal(nextLivePoll(feed(5100)), 1000);
  assert.equal(nextLivePoll(feed(9000)), 1000);
});

test("falls back to a plain interval without timing to align to", () => {
  assert.equal(nextLivePoll(undefined), 5000);
  assert.equal(nextLivePoll(feed()), 5000);
  assert.equal(nextLivePoll(feed(1200, false)), 5000);
  assert.equal(nextLivePoll(feed(60000)), 5000);
});
