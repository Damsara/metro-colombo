import { CircleHelp } from "lucide-react";
import { useLingui } from "@lingui/react/macro";

export function HowToUse({ hidden }: { hidden: boolean }) {
  const { t } = useLingui();
  return (
    <details
      className="mt-7 border-t border-line pt-4 text-sm leading-relaxed text-muted"
      hidden={hidden}
    >
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-ink">
        <CircleHelp size={17} />
        {t`How do I use this?`}
      </summary>
      <ol className="mt-2 mb-3.5 list-decimal pl-5 [&>li]:my-2">
        <li>{t`Type your starting stop and choose a result.`}</li>
        <li>{t`Choose where you want to get off.`}</li>
        <li>
          {t`Press “Find my bus”. Select a departure for boarding instructions.`}
        </li>
      </ol>
      <p className="text-xs">
        {t`Times are in Sri Lanka time. Live estimates are marked separately from scheduled times. Not affiliated with Lanka Metro Transit, Smart Metro, or the official LMT GO app. For trip planning only, not tickets or official service information.`}
      </p>
    </details>
  );
}
