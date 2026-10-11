import { CHRISTMAS_TREES } from "../decorations";
import { StarsTwinkle } from "../moments/StarsTwinkle";
import type { OccasionTheme } from "../types";
import { GREETINGS, holidayNote } from "./greetings";

export const christmas: OccasionTheme = {
  kind: "christmas",
  greeting: GREETINGS.christmas,
  note: holidayNote,
  ambient: { tint: "#d8f0e0", strength: 0.12 },
  stops: CHRISTMAS_TREES,
  busGlow: "#f6c440",
  moment: StarsTwinkle,
};
