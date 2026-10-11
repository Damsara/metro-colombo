import { OIL_LAMPS } from "../decorations";
import { LampsGlow } from "../moments/LampsGlow";
import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const avurudu: OccasionTheme = {
  kind: "avurudu",
  greeting: GREETINGS.avurudu,
  note: holidayNote,
  ambient: { tint: "#e0a03a", strength: 0.16 },
  stops: OIL_LAMPS,
  busGlow: "#f2b33d",
  moment: LampsGlow,
};
