import type { OccasionKind, OccasionTheme } from "../types";

export function themeFor(kind: OccasionKind): OccasionTheme {
  return { kind, greeting: () => kind };
}
