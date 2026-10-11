import { useMemo } from "react";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { STARS } from "../decorations";
import { between, REDUCED_MOTION } from "./shared";

export function StarsTwinkle() {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const stars = useMemo(
    () =>
      Array.from({ length: 18 }, () => ({
        left: between(3, 97),
        top: between(4, 48),
        size: between(14, 26),
        delay: between(0, 1),
      })),
    [],
  );
  if (reduced) return null;
  const src = STARS.images[0];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((star, index) => (
        <img
          key={index}
          src={src}
          alt=""
          className="occasion-twinkle absolute opacity-0"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
