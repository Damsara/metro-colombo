import type { I18n } from "@lingui/core";
import type { ComponentType } from "react";

// Same list and order as packages/core/src/occasions/kinds.ts; earlier kinds win when two share a date.
export const OCCASION_KINDS = [
  "vesak",
  "poson",
  "avurudu",
  "deepavali",
  "christmas",
  "thaiPongal",
  "eidUlFitr",
  "eidUlAdha",
  "miladUnNabi",
  "mahasivarathri",
  "goodFriday",
  "nationalDay",
  "newYear",
  "newYearsEve",
  "poya",
  "mayDay",
] as const;

export type OccasionKind = (typeof OCCASION_KINDS)[number];

export type Occasion = { date: string; kind: OccasionKind; title: string };

export interface Credit {
  title: string;
  author: string;
  href: string;
  license: string;
}

export interface Wind {
  // Local metres, x east and z south.
  towards: { x: number; z: number };
  lean: number;
  gust: number;
  sway: number;
}

export interface StopStand {
  // A glb whose single root node holds one child per variant, cycled along the stops.
  model: string;
  meters: number;
  pixels: { city: number; street: number };
  // With a pole the model hangs from the arm's tip; without one it stands on the ground.
  pole?: { color: number; height: number; arm: number };
  wind?: Wind;
}

export interface StopDecoration {
  id: string;
  images: readonly string[];
  stand?: StopStand;
  credit?: Credit;
}

export interface OccasionTheme {
  kind: OccasionKind;
  greeting: (i18n: I18n) => string;
  note?: (i18n: I18n) => string;
  ambient?: { tint: string; strength: number };
  busGlow?: string;
  stops?: StopDecoration;
  moment?: ComponentType;
}
