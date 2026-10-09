import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { dateLabel } from "../i18n";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";
import { IconButton } from "./ui/IconButton";

/** The top of the results page: the trip searched for, and a way back to edit it. */
export function TripSummary({
  fromName,
  toName,
  date,
  onEdit,
}: {
  fromName: string;
  toName: string;
  date: string;
  onEdit: () => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <div className={`mb-1 flex items-center gap-3 px-3 py-2.5 ${cardClass()}`}>
      <IconButton
        variant="tinted"
        label={t`Back to the trip form`}
        onClick={onEdit}
      >
        <ArrowLeft size={19} />
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-md font-semibold">
          <span className="sr-only">{t`From ${fromName} to ${toName}`}</span>
          <span className="truncate" aria-hidden="true">
            {fromName}
          </span>
          <ArrowRight
            className="shrink-0 text-faint"
            size={15}
            aria-hidden="true"
          />
          <span className="truncate" aria-hidden="true">
            {toName}
          </span>
        </p>
        <p className="text-xs text-muted">{dateLabel(i18n, date)}</p>
      </div>
      <Button variant="quiet" size="sm" onClick={onEdit}>
        {t`Edit`}
      </Button>
    </div>
  );
}
