import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const deepavali: OccasionTheme = {
  kind: "deepavali",
  greeting: GREETINGS.deepavali,
  note: holidayNote,
  ambient: { tint: "#ff9a3c", strength: 0.18 },
  stopMark: "oilLamp",
  busGlow: "#ffb347",
  moment: "lampsGlow",
};
