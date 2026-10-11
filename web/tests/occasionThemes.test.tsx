import assert from "node:assert/strict";
import { test } from "vitest";
import { decorationSvg } from "../src/occasions/decorations";

test("every decoration is a standalone SVG", () => {
  for (const id of ["lantern", "oilLamp", "star"] as const) {
    const svg = decorationSvg(id);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 36 44"/);
    assert.notEqual(decorationSvg("lantern"), decorationSvg("star"));
  }
});
