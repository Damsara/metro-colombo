import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { palette, type PaletteToken } from "../src/theme";

const WHITE = "#ffffff";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

type Pair = [text: string, background: string, name: string];

const onSurfaces = (text: PaletteToken, surfaces: PaletteToken[]): Pair[] =>
  surfaces.map((surface) => [
    palette[text],
    palette[surface],
    `${text} on ${surface}`,
  ]);

// Warning text only sits on the page and on cards, never on a selected field.
const SURFACES: PaletteToken[] = ["paper", "field", "card", "tint-50"];
const PAIRS: Pair[] = [
  ...onSurfaces("ink", SURFACES),
  ...onSurfaces("muted", SURFACES),
  ...onSurfaces("danger", SURFACES),
  ...onSurfaces("brand", SURFACES),
  ...onSurfaces("warning", ["paper", "card"]),
  [palette["soon-ink"], palette.soon, "soon-ink on soon"],
  [palette.live, palette["live-50"], "live on live-50"],
  [palette.warning, palette["warning-50"], "warning on warning-50"],
  [palette.ink, palette["warning-50"], "ink on warning-50"],
  [palette.danger, palette["danger-50"], "danger on danger-50"],
  [WHITE, palette.ink, "white on ink"],
  [WHITE, palette.bus, "white on bus"],
  [WHITE, palette.muted, "white on the fallback route colour"],
];

for (const [text, background, name] of PAIRS) {
  test(`${name} meets WCAG AA`, () => {
    const ratio = contrast(text, background);
    assert.ok(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}:1`);
  });
}

test("styles.css colour tokens match theme.ts", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), {
    encoding: "utf8",
  });
  const tokens = Object.fromEntries(
    [...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]{6});/gi)].map(
      ([, name, value]) => [name, value.toLowerCase()],
    ),
  );
  assert.deepEqual(tokens, palette);
});
