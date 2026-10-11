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

// A stop's platforms sit either side of the road and share one decoration.
const SAME_PLACE_METERS = 30;
const METERS_PER_DEGREE = 111_320;

function metersApart(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const x =
    (a.longitude - b.longitude) *
    Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  return Math.hypot(x, a.latitude - b.latitude) * METERS_PER_DEGREE;
}

export function festiveStops<
  T extends { id: string; latitude: number; longitude: number },
>(sources: readonly (readonly T[])[], always: readonly T[] = []): T[] {
  const source = sources.find((list) => list.length) ?? [];
  const kept: T[] = [];
  for (const stop of [...always, ...source]) {
    if (kept.length === MAX_MARKED_STOPS) break;
    if (
      kept.every(
        (other) =>
          other.id !== stop.id && metersApart(other, stop) > SAME_PLACE_METERS,
      )
    )
      kept.push(stop);
  }
  return kept;
}
