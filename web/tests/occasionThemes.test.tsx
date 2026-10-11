import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, test, vi } from "vitest";
import { i18n } from "../src/i18n";
import { decorationSvg } from "../src/occasions/decorations";
import { MOMENTS } from "../src/occasions/moments";
import { themeFor } from "../src/occasions/themes";
import { OCCASION_KINDS } from "../src/occasions/types";

beforeAll(() => {
  i18n.activate("en");
});

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

test("every occasion has a theme with a greeting", () => {
  for (const kind of OCCASION_KINDS) {
    const theme = themeFor(kind);
    assert.equal(theme.kind, kind);
    assert.ok(theme.greeting(i18n).length > 0, kind);
  }
});

test("the five first-release occasions are fully themed", () => {
  for (const kind of [
    "vesak",
    "poya",
    "avurudu",
    "deepavali",
    "christmas",
  ] as const) {
    const theme = themeFor(kind);
    assert.ok(theme.stopMark && theme.moment && theme.ambient, kind);
  }
});

test("Poson borrows the Poya look with its own greeting", () => {
  assert.equal(themeFor("poson").stopMark, themeFor("poya").stopMark);
  assert.notEqual(
    themeFor("poson").greeting(i18n),
    themeFor("poya").greeting(i18n),
  );
});
