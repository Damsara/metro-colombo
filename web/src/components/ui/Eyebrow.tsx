import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-2xs leading-relaxed font-bold tracking-[0.15em] text-muted uppercase">
      {children}
    </span>
  );
}
