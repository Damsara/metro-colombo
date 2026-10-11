import type { OccasionKind, OccasionTheme } from "../types";
import { avurudu } from "./avurudu";
import { christmas } from "./christmas";
import { deepavali } from "./deepavali";
import { GREETINGS, holidayNote } from "./greetings";
import { poya } from "./poya";
import { vesak } from "./vesak";

const FULL: Partial<Record<OccasionKind, OccasionTheme>> = {
  vesak,
  poson: { ...poya, kind: "poson", greeting: GREETINGS.poson },
  poya,
  avurudu,
  deepavali,
  christmas,
};

export function themeFor(kind: OccasionKind): OccasionTheme {
  return (
    FULL[kind] ?? {
      kind,
      greeting: GREETINGS[kind],
      note: kind === "newYearsEve" ? undefined : holidayNote,
    }
  );
}
