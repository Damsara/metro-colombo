import type { ComponentType } from "react";
import type { MomentId } from "../types";
import { LampsGlow } from "./LampsGlow";
import { LanternsRise } from "./LanternsRise";
import { StarsTwinkle } from "./StarsTwinkle";

export const MOMENTS: Record<MomentId, ComponentType> = {
  lanternsRise: LanternsRise,
  lampsGlow: LampsGlow,
  starsTwinkle: StarsTwinkle,
};
