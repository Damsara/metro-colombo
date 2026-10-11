import { OIL_LAMPS } from "../decorations";
import { LampsGlow } from "../moments/LampsGlow";
import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const deepavali: OccasionTheme = {
  kind: "deepavali",
  greeting: GREETINGS.deepavali,
  note: holidayNote,
  ambient: { tint: "#ff9a3c", strength: 0.18 },
  stops: OIL_LAMPS,
  busGlow: "#ffb347",
  moment: LampsGlow,
};
