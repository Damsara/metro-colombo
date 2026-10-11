import assert from "node:assert/strict";
import { test } from "vitest";
import { OCCASION_KINDS as SERVER_KINDS } from "../../src/occasion-kinds";
import { OCCASION_KINDS as WEB_KINDS } from "../src/occasions/types";

test("the server and web agree on occasion kinds and their priority", () => {
  assert.deepEqual([...WEB_KINDS], [...SERVER_KINDS]);
});
