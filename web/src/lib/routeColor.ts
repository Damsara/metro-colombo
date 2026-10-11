import { palette } from "../theme";

const HEX = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

export function routeColor(hex: string | undefined): string {
  return hex && HEX.test(hex) ? hex : palette.muted;
}
