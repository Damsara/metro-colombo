import { useEffect } from "react";
import { MOMENTS } from "./moments";
import type { OccasionTheme } from "./types";

const MOMENT_MS = 5500;

export function OccasionLayers({
  theme,
  playMoment,
  onMomentDone,
}: {
  theme: OccasionTheme;
  playMoment: boolean;
  onMomentDone: () => void;
}) {
  useEffect(() => {
    if (!playMoment) return;
    const timer = setTimeout(onMomentDone, MOMENT_MS);
    return () => clearTimeout(timer);
  }, [playMoment, onMomentDone]);
  const Moment = playMoment && theme.moment ? MOMENTS[theme.moment] : null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {theme.ambient && (
        <div
          className="absolute inset-0 mix-blend-multiply"
          style={{
            background: `radial-gradient(120% 80% at 50% 0%, transparent, ${theme.ambient.tint})`,
            opacity: theme.ambient.strength,
          }}
        />
      )}
      {Moment && <Moment />}
    </div>
  );
}
