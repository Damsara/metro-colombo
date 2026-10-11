import { useEffect } from "react";
import type { OccasionTheme } from "./types";

const MOMENT_MS = 5500;

export function OccasionLayers({
  theme,
  playMoment,
  onMomentDone,
  bottomInset = 0,
}: {
  theme: OccasionTheme;
  playMoment: boolean;
  onMomentDone: () => void;
  bottomInset?: number;
}) {
  useEffect(() => {
    if (!playMoment) return;
    const timer = setTimeout(onMomentDone, MOMENT_MS);
    return () => clearTimeout(timer);
  }, [playMoment, onMomentDone]);
  const Moment = playMoment ? theme.moment : undefined;
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
      {Moment && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ bottom: bottomInset }}
        >
          <Moment />
        </div>
      )}
    </div>
  );
}
