import type { ReactNode } from "react";

interface Tab<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  className = "",
}: {
  label: string;
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <nav
      role="tablist"
      aria-label={label}
      className={`grid grid-cols-2 gap-2 max-md:gap-1.5 ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className="flex min-h-12 items-center justify-center gap-2.5 rounded-md text-base font-semibold text-muted aria-selected:bg-field aria-selected:text-ink aria-selected:shadow-[inset_0_-3px_0_var(--color-stripe)] max-md:gap-2 max-md:text-md hover-fine:not-aria-selected:bg-tint-50 aria-selected:[&_svg]:text-brand"
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
