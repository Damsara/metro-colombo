import { OIL_LAMPS } from "../decorations";
import { LampsGlow } from "../moments/LampsGlow";
import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const poya: OccasionTheme = {
  kind: "poya",
  greeting: GREETINGS.poya,
  note: holidayNote,
  ambient: { tint: "#c9d6ff", strength: 0.14 },
  stops: OIL_LAMPS,
  busGlow: "#e9eefc",
  moment: LampsGlow,
};
