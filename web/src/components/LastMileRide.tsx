import { useLingui } from "@lingui/react/macro";
import {
  COLOMBO_TARIFF,
  lastMileEstimate,
  type Point,
  type Tariff,
} from "../lib/pickmeFare";
import { PICKME_STORE_URL, pickmeTripLink } from "../lib/pickmeLink";
import { buttonClass } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";

export function LastMileRide({
  from,
  to,
  hour,
  tariff = COLOMBO_TARIFF,
  className = "",
}: {
  from: Point;
  to: Point;
  hour: number;
  tariff?: Tariff;
  className?: string;
}) {
  const { t } = useLingui();
  const estimate = lastMileEstimate(from, to, hour, tariff);
  const road = [estimate.km.low, estimate.km.high]
    .map((value) =>
      value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`,
    )
    .join("–");
  const money = estimate.fare
    ? [estimate.fare.low, estimate.fare.high]
        .map((amount) => `Rs ${amount.toLocaleString("en-LK")}`)
        .join("–")
    : null;

  return (
    <section
      className={`rounded-md border border-line bg-card p-3 ${className}`}
    >
      <Eyebrow>{t`Finish with a ride`}</Eyebrow>
      <p className="mt-1 text-sm text-ink">
        {t`About ${road} by road, ${estimate.minutes.low}–${estimate.minutes.high} min in traffic.`}
      </p>
      {money ? (
        <p className="text-sm text-muted">{t`Roughly ${money} by car, before surge.`}</p>
      ) : (
        <p className="text-sm text-muted">{t`Price shown in the PickMe app.`}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          className={buttonClass({ variant: "primary", size: "sm" })}
          href={pickmeTripLink(from, to)}
          rel="noreferrer noopener"
          target="_blank"
        >
          {t`Open PickMe`}
        </a>
        <a
          className="text-xs text-muted underline"
          href={PICKME_STORE_URL}
          rel="noreferrer noopener"
          target="_blank"
        >
          {t`Get the app`}
        </a>
      </div>
    </section>
  );
}
