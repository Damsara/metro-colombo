import {
  OCCASION_KINDS,
  type Occasion,
  type OccasionKind,
} from "./occasion-kinds.js";

const RULES: ReadonlyArray<readonly [RegExp, OccasionKind]> = [
  [/vesak/i, "vesak"],
  [/poson/i, "poson"],
  [/new year/i, "avurudu"],
  [/deepavali/i, "deepavali"],
  [/christmas/i, "christmas"],
  [/pongal/i, "thaiPongal"],
  [/fitr/i, "eidUlFitr"],
  [/alha|adha/i, "eidUlAdha"],
  [/milad/i, "miladUnNabi"],
  [/sivarathri/i, "mahasivarathri"],
  [/good friday/i, "goodFriday"],
  [/national day/i, "nationalDay"],
  [/poya/i, "poya"],
  [/may day/i, "mayDay"],
];

export function classify(title: string): OccasionKind | null {
  return RULES.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

export function parseIcs(text: string): Array<{ date: string; title: string }> {
  const lines = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const events: Array<{ date: string; title: string }> = [];
  let date: string | undefined;
  let title: string | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") date = title = undefined;
    const start = /^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/.exec(line);
    if (start) date = `${start[1]}-${start[2]}-${start[3]}`;
    if (line.startsWith("SUMMARY:")) title = line.slice(8).trim();
    if (line === "END:VEVENT" && date && title) events.push({ date, title });
  }
  return events;
}

export function fixedOccasions(fromYear: number, toYear: number): Occasion[] {
  const result: Occasion[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    result.push(
      { date: `${year}-01-01`, kind: "newYear", title: "New Year's Day" },
      { date: `${year}-12-31`, kind: "newYearsEve", title: "New Year's Eve" },
    );
  }
  return result;
}

const priority = (kind: OccasionKind) => OCCASION_KINDS.indexOf(kind);

export function toOccasions(
  events: ReadonlyArray<{ date: string; title: string }>,
  fromYear: number,
  toYear: number,
): Occasion[] {
  const fromFeed = events.flatMap((event): Occasion[] => {
    const kind = classify(event.title);
    return kind ? [{ ...event, kind }] : [];
  });
  return [...fromFeed, ...fixedOccasions(fromYear, toYear)].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || priority(a.kind) - priority(b.kind),
  );
}
