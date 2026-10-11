import { useMemo } from "react";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { between, decorationUrl, REDUCED_MOTION } from "./shared";

export function LanternsRise() {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const lanterns = useMemo(
    () =>
      Array.from({ length: 14 }, () => ({
        left: between(5, 95),
        scale: between(0.6, 1.2),
        delay: between(0, 2.2),
      })),
    [],
  );
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {lanterns.map((lantern, index) => (
        <img
          key={index}
          src={decorationUrl("lantern", index)}
          alt=""
          width={30}
          height={60}
          className="occasion-rise absolute bottom-0 opacity-0"
          style={{
            left: `${lantern.left}%`,
            animationDelay: `${lantern.delay}s`,
            ["--scale" as string]: lantern.scale,
          }}
        />
      ))}
    </div>
  );
}
