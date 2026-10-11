import { useMemo } from "react";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { between, decorationUrl, REDUCED_MOTION } from "./shared";

const LAMPS = 12;

export function LampsGlow() {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const offsets = useMemo(
    () => Array.from({ length: LAMPS }, () => between(0, 0.5)),
    [],
  );
  if (reduced) return null;
  const src = decorationUrl("oilLamp");
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="occasion-glow absolute inset-x-0 bottom-3 flex justify-around opacity-0">
        {offsets.map((offset, index) => (
          <img
            key={index}
            src={src}
            alt=""
            width={36}
            height={44}
            className="occasion-flicker"
            style={{ animationDelay: `${offset}s` }}
          />
        ))}
      </div>
    </div>
  );
}
