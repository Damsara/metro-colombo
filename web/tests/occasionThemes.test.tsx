import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
import { decorationSvg } from "../src/occasions/decorations";
import { MOMENTS } from "../src/occasions/moments";

test("every decoration is a standalone SVG", () => {
  for (const id of ["lantern", "oilLamp", "star"] as const) {
    const svg = decorationSvg(id);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 36 44"/);
    assert.notEqual(decorationSvg("lantern"), decorationSvg("star"));
  }
});

test("every moment renders without taking taps", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  for (const Moment of Object.values(MOMENTS)) {
    const html = renderToStaticMarkup(<Moment />);
    assert.match(html, /^<div class="[^"]*pointer-events-none/);
  }
  vi.unstubAllGlobals();
});

test("moments render nothing when motion is reduced", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  for (const Moment of Object.values(MOMENTS)) {
    assert.equal(renderToStaticMarkup(<Moment />), "");
  }
  vi.unstubAllGlobals();
});
