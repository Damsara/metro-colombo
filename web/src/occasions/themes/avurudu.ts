import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const avurudu: OccasionTheme = {
  kind: "avurudu",
  greeting: GREETINGS.avurudu,
  note: holidayNote,
  ambient: { tint: "#e0a03a", strength: 0.16 },
  stopMark: "oilLamp",
  busGlow: "#f2b33d",
  moment: "lampsGlow",
};
