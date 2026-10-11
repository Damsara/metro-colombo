import assert from "node:assert/strict";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, test, vi } from "vitest";
import { creditHtml } from "../src/components/festiveMap";
import { i18n } from "../src/i18n";
import { LANTERNS, OIL_LAMPS, STARS } from "../src/occasions/decorations";
import { themeFor } from "../src/occasions/themes";
import { OCCASION_KINDS } from "../src/occasions/types";

beforeAll(() => {
  i18n.activate("en");
});

const themes = OCCASION_KINDS.map(themeFor);
const moments = [
  ...new Set(
    themes.flatMap((theme): ComponentType[] =>
      theme.moment ? [theme.moment] : [],
    ),
  ),
];
const decorations = [
  ...new Set(themes.flatMap((theme) => (theme.stops ? [theme.stops] : []))),
];

test("every decoration has pictures for the flat map and a unique id", () => {
  for (const decoration of decorations) {
    assert.ok(decoration.images.length > 0, decoration.id);
  }
  assert.equal(
    new Set(decorations.map((decoration) => decoration.id)).size,
    decorations.length,
  );
});

test("Vesak hangs four different lanterns, the lamps and stars draw one SVG", () => {
  assert.equal(new Set(LANTERNS.images).size, 4);
  assert.ok(LANTERNS.stand?.pole);
  for (const decoration of [OIL_LAMPS, STARS]) {
    assert.equal(decoration.images.length, 1);
    assert.match(decoration.images[0], /^data:image\/svg\+xml/);
  }
});

test("every 3D stand is credited and sized sensibly", () => {
  for (const decoration of decorations) {
    const stand = decoration.stand;
    if (!stand) continue;
    assert.ok(decoration.credit, decoration.id);
    assert.ok(stand.pixels.city <= stand.pixels.street, decoration.id);
    assert.ok(stand.meters > 0, decoration.id);
  }
});

test("the credit links the work and escapes its text", () => {
  const html = creditHtml(
    {
      title: "A <b>",
      author: "me",
      href: "https://x.test/?a=1&b=2",
      license: "CC BY 4.0",
    },
    i18n,
  );
  assert.match(
    html,
    /^Decorations: <a href="https:\/\/x\.test\/\?a=1&#38;b=2"/,
  );
  assert.match(html, /“A &#60;b&#62;” by me<\/a>, CC BY 4\.0$/);
});

test("every moment renders without taking taps", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  for (const Moment of moments) {
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
  for (const Moment of moments) {
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
    assert.ok(theme.stops && theme.moment && theme.ambient, kind);
  }
});

test("Poson borrows the Poya look with its own greeting", () => {
  assert.equal(themeFor("poson").stops, themeFor("poya").stops);
  assert.notEqual(
    themeFor("poson").greeting(i18n),
    themeFor("poya").greeting(i18n),
  );
});
