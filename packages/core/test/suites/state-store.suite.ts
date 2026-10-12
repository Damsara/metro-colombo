import assert from "node:assert/strict";
import { Effect, Option } from "effect";
import type { StateStoreShape } from "@metro/core";
import type { Register } from "@metro/core/testing";

export type WithStateStore = (body: (open: () => StateStoreShape) => Promise<void>) => Promise<void>;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export function stateStoreSuite(test: Register, name: string, withState: WithStateStore) {
  test(`${name}: a missing key is none`, () =>
    withState(async (open) => {
      assert.ok(Option.isNone(await run(open().get("session"))));
    }));

  test(`${name}: JSON values round-trip and a reopened store still has them`, () =>
    withState(async (open) => {
      const value = { refreshToken: "r", expiresAt: 1_791_685_800_000, otpReference: null, tags: ["a", "b"], nested: { ok: true } };
      await run(open().set("session", value));
      const found = await run(open().get("session"));
      assert.ok(Option.isSome(found));
      assert.deepEqual(found.value, value);
    }));

  test(`${name}: set replaces, delete removes, and deleting twice is fine`, () =>
    withState(async (open) => {
      const store = open();
      await run(store.set("login", { reason: "a" }));
      await run(store.set("login", { reason: "b" }));
      assert.deepEqual(Option.getOrUndefined(await run(store.get("login"))), { reason: "b" });
      await run(store.delete("login"));
      await run(store.delete("login"));
      assert.ok(Option.isNone(await run(open().get("login"))));
    }));

  test(`${name}: keys are independent`, () =>
    withState(async (open) => {
      const store = open();
      await run(store.set("session", { refreshToken: "r" }));
      await run(store.set("alerts", { login: { since: 1, sentAt: 1 } }));
      await run(store.delete("alerts"));
      assert.deepEqual(Option.getOrUndefined(await run(open().get("session"))), { refreshToken: "r" });
    }));
}
