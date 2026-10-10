/**
 * The colour palette, as hex values. styles.css defines the same values as
 * Tailwind tokens (a test keeps the two in step); this copy is for code that
 * can't read CSS variables, such as map layer paint.
 *
 * Charcoal (ink) is for doing things, red is the bus, yellow is the bus's
 * side stripe (thin accents only, never text), parchment is the surface.
 */
export const palette = {
  paper: "#f1ede4",
  card: "#f9f7f2",
  field: "#e7e1d5",
  map: "#ebe6dc",
  "tint-50": "#ece7dd",
  "tint-100": "#e7e1d5",
  "tint-200": "#ddd6c8",
  line: "#e0d9cb",
  "line-strong": "#cec5b4",
  ink: "#211d19",
  muted: "#685e52",
  faint: "#a69c8e",
  brand: "#b42318",
  bus: "#b42318",
  live: "#b42318",
  "live-50": "#f8e4df",
  stripe: "#f6c440",
  soon: "#fff1b8",
  "soon-ink": "#5c4400",
  warning: "#8f6200",
  "warning-50": "#fbf1d6",
  "warning-200": "#e6d6a8",
  danger: "#8e1b12",
  "danger-50": "#f9e6e1",
  "danger-200": "#ebcbc3",
  destination: "#d26540",
} as const;

export type PaletteToken = keyof typeof palette;
