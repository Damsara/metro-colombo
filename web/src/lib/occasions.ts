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

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MOMENT_KEY = "lmt.occasionMoment";
const OFF_KEY = "lmt.festiveOff";

export const momentKey = (occasion: Occasion) =>
  `${occasion.date}:${occasion.kind}`;

function read(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: string | null) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    return;
  }
}

export function shouldPlayMoment(
  store: KeyValueStore | null,
  occasion: Occasion,
  played: Set<string>,
): boolean {
  const key = momentKey(occasion);
  return !played.has(key) && read(store, MOMENT_KEY) !== key;
}

export function markMomentPlayed(
  store: KeyValueStore | null,
  occasion: Occasion,
  played: Set<string>,
): void {
  played.add(momentKey(occasion));
  write(store, MOMENT_KEY, momentKey(occasion));
}

export const festiveOff = (store: KeyValueStore | null) =>
  read(store, OFF_KEY) === "1";

export const setFestiveOff = (store: KeyValueStore | null, off: boolean) =>
  write(store, OFF_KEY, off ? "1" : null);

const MAX_MARKED_STOPS = 80;

export function festiveStops<T extends { id: string }>(
  journeyStops: readonly T[],
  routeStops: readonly T[],
): T[] {
  const source = journeyStops.length ? journeyStops : routeStops;
  const seen = new Set<string>();
  return source
    .filter((stop) => !seen.has(stop.id) && seen.add(stop.id))
    .slice(0, MAX_MARKED_STOPS);
}
