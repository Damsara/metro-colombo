import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BusFront } from "lucide-react";

export function AppHeader({
  homeLabel,
  suffix,
  reloadHome = false,
  className = "",
  children,
}: {
  homeLabel: string;
  suffix?: string;
  reloadHome?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <header
      className={`flex min-h-22 items-center justify-between gap-6 border-b border-line bg-paper px-8 pt-[calc(14px+env(safe-area-inset-top))] pb-3.5 max-md:min-h-15 max-md:gap-3 max-md:px-4 max-md:pt-[calc(8px+env(safe-area-inset-top))] max-md:pb-2 ${className}`}
    >
      <Link
        className="flex items-center gap-3 text-4xl leading-none font-bold tracking-tighter max-md:gap-2.5 max-md:text-3xl"
        to="/"
        reloadDocument={reloadHome}
        aria-label={homeLabel}
      >
        <span className="relative grid h-12 w-11 place-items-center overflow-hidden rounded-lg bg-brand text-white max-md:h-10 max-md:w-9">
          <BusFront size={25} className="max-md:size-[22px]" />
          <span className="absolute inset-x-0 bottom-1.5 h-0.5 bg-stripe" />
        </span>
        <span>
          metro<span className="text-brand">.</span>
          {suffix && <small>{suffix}</small>}
        </span>
      </Link>
      {children}
    </header>
  );
}
