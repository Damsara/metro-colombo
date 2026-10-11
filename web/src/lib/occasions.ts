import {
  OCCASION_KINDS,
  type Occasion,
  type OccasionKind,
} from "../occasions/types";

const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;

export function colomboDate(now: Date): string {
  return new Date(now.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseOccasionKind(value: unknown): OccasionKind | null {
  return typeof value === "string" &&
    (OCCASION_KINDS as readonly string[]).includes(value)
    ? (value as OccasionKind)
    : null;
}

export function todaysOccasion(
  occasions: readonly Occasion[],
  today: string,
  preview: OccasionKind | null,
): Occasion | null {
  if (preview) return { date: today, kind: preview, title: preview };
  const rank = (kind: OccasionKind) => OCCASION_KINDS.indexOf(kind);
  return (
    occasions
      .filter((occasion) => occasion.date === today)
      .sort((a, b) => rank(a.kind) - rank(b.kind))[0] ?? null
  );
}
