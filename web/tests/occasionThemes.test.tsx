import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, test, vi } from "vitest";
import { i18n } from "../src/i18n";
import { decorationImages, decorationSvg } from "../src/occasions/decorations";
import { MOMENTS } from "../src/occasions/moments";
import { themeFor } from "../src/occasions/themes";
import { OCCASION_KINDS } from "../src/occasions/types";

beforeAll(() => {
  i18n.activate("en");
});

test("lamps and stars are standalone SVGs", () => {
  for (const id of ["oilLamp", "star"] as const) {
    const svg = decorationSvg(id);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 36 44"/);
  }
  assert.notEqual(decorationSvg("oilLamp"), decorationSvg("star"));
});

test("Vesak has four lantern pictures, the others one each", () => {
  assert.equal(decorationImages("lantern").length, 4);
  assert.equal(new Set(decorationImages("lantern")).size, 4);
  assert.equal(decorationImages("star").length, 1);
  assert.match(decorationImages("oilLamp")[0], /^data:image\/svg\+xml/);
});

test("every moment renders without taking taps", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  for (const Moment of Object.values(MOMENTS)) {
    const html = renderToStaticMarkup(<Moment />).replace(
      /^(<link [^>]*>)*/,
      "",
    );
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
