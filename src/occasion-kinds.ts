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

export type Occasion = {
  readonly date: string;
  readonly kind: OccasionKind;
  readonly title: string;
};
