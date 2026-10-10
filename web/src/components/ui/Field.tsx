import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A labelled form control. `inline` puts the label beside the control inside
 * a bordered box; `stacked` puts it above.
 */
export function Field({
  label,
  layout = "stacked",
  className = "",
  children,
}: {
  label: ReactNode;
  layout?: "inline" | "stacked";
  className?: string;
  children: ReactNode;
}) {
  const inline = layout === "inline";
  return (
    <label
      className={
        inline
          ? `flex min-h-13 items-center justify-between gap-3 rounded-md border border-line bg-card px-3 py-2 text-md ${className}`
          : `flex flex-col gap-2 ${className}`
      }
    >
      <span
        className={
          inline
            ? "shrink-0 whitespace-nowrap text-muted"
            : "text-sm text-muted"
        }
      >
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * A drop-down list. The native control is restyled (Safari otherwise keeps
 * its own compact look and ignores the height), with our own chevron.
 */
export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative block ${className}`}>
      <select
        className="min-h-12 w-full appearance-none rounded-md border border-line bg-card py-3 pr-10 pl-3"
        {...props}
      />
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </span>
  );
}
