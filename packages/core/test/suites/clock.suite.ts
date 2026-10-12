import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { testClockAt, type Register } from "@metro/core/testing";

export function clockSuite(test: Register, name: string) {
  test(`${name}: TestClock drives Clock`, async () => {
    const at = Date.parse("2026-10-12T08:00:00+05:30");
    assert.equal(
      await Effect.runPromise(
        Clock.currentTimeMillis.pipe(Effect.provide(testClockAt(at))),
      ),
      at,
    );
  });

  test(`${name}: the live clock follows Date.now`, async () => {
    const before = Date.now();
    const now = await Effect.runPromise(Clock.currentTimeMillis);
    const after = Date.now();
    assert.ok(now >= before && now <= after);
  });
}
