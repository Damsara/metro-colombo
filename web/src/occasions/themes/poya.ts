import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const poya: OccasionTheme = {
  kind: "poya",
  greeting: GREETINGS.poya,
  note: holidayNote,
  ambient: { tint: "#c9d6ff", strength: 0.14 },
  stopMark: "oilLamp",
  busGlow: "#e9eefc",
  moment: "lampsGlow",
};
