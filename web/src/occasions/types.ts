import type { I18n } from "@lingui/core";

// Same list and order as src/occasion-kinds.ts; earlier kinds win when two share a date.
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

export type DecorationId = "lantern" | "oilLamp" | "star";

export type MomentId = "lanternsRise" | "lampsGlow" | "starsTwinkle";

export interface OccasionTheme {
  kind: OccasionKind;
  greeting: (i18n: I18n) => string;
  note?: (i18n: I18n) => string;
  ambient?: { tint: string; strength: number };
  stopMark?: DecorationId;
  busGlow?: string;
  moment?: MomentId;
}
