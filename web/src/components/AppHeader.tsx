import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BusFront } from "lucide-react";

/** The page header: the Metro wordmark (linking home) and page actions. */
export function AppHeader({
  homeLabel,
  suffix,
  reloadHome = false,
  className = "",
  children,
}: {
  homeLabel: string;
  /** Small text after the wordmark, e.g. "API". */
  suffix?: string;
  /** Reload the app from scratch, resetting any trip in progress. */
  reloadHome?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <header
      className={`flex min-h-22 items-center justify-between gap-6 border-b border-line bg-paper px-8 pt-[calc(14px+env(safe-area-inset-top))] pb-3.5 max-md:min-h-19 max-md:gap-3 max-md:px-4.5 max-md:pt-[calc(12px+env(safe-area-inset-top))] max-md:pb-3 ${className}`}
    >
      <Link
        className="flex items-center gap-3 text-4xl leading-none font-bold tracking-tighter max-md:text-3xl"
        to="/"
        reloadDocument={reloadHome}
        aria-label={homeLabel}
      >
        <span className="grid h-12 w-11 place-items-center rounded-lg bg-brand text-white max-md:h-11 max-md:w-10">
          <BusFront size={25} />
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
