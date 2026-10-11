import { LANTERNS } from "../decorations";
import { LanternsRise } from "../moments/LanternsRise";
import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const vesak: OccasionTheme = {
  kind: "vesak",
  greeting: GREETINGS.vesak,
  note: holidayNote,
  ambient: { tint: "#f6c440", strength: 0.18 },
  stops: LANTERNS,
  busGlow: "#f6c440",
  moment: LanternsRise,
};
