import { useId, useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useConsent } from "../lib/consent";
import { Button } from "./ui/Button";
import { cardClass } from "./ui/Card";

/**
 * Asks once whether usage may be counted. Not a wall: the app works behind
 * it, and both answers are one equal tap.
 */
export function ConsentPrompt() {
  const { t } = useLingui();
  const { asking, choice, allow, decline, dismiss } = useConsent();
  const [details, setDetails] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  if (!asking) return null;

  return (
    <section
      className={`fixed z-50 p-5 shadow-menu ${cardClass()} right-6 bottom-6 w-96 max-w-[calc(100%-48px)] max-md:inset-x-3 max-md:top-[calc(72px+env(safe-area-inset-top))] max-md:bottom-auto max-md:w-auto max-md:max-w-none`}
      aria-labelledby={titleId}
    >
      <div className="flex items-start gap-3">
        <BarChart3
          className="mt-0.5 shrink-0 text-muted"
          size={20}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg leading-tight font-semibold">
            {t`Help us make Metro better?`}
          </h2>
          <p className="mt-1.5 text-sm leading-normal text-muted">
            {t`With your OK, we count how the app is used, like which trips people search and which features they use, so we know what to improve next.`}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink"
        aria-expanded={details}
        aria-controls={detailsId}
        onClick={() => setDetails((open) => !open)}
      >
        {t`What we collect`}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={details ? "rotate-180" : ""}
        />
      </button>
      {details && (
        <ul
          id={detailsId}
          className="mb-1 list-disc space-y-1 pl-5 text-sm leading-normal text-muted"
        >
          <li>{t`Pages you open, and actions like searching a trip, following or tracking a bus, opening a route or changing language.`}</li>
          <li>{t`Route and stop codes and how many days ahead you search.`}</li>
          <li>{t`Never your name, your location or anything you type.`}</li>
          <li>{t`It's handled by Google Analytics.`}</li>
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button onClick={decline}>{t`No thanks`}</Button>
        <Button variant="primary" onClick={allow}>
          {t`Allow`}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted">
        {t`You can change this any time from “Privacy choices” at the bottom of the page.`}
      </p>
      {choice !== null && (
        <Button variant="quiet" className="mt-1" onClick={dismiss}>
          {t`Keep my current choice`}
        </Button>
      )}
    </section>
  );
}

/** The footer link that reopens the prompt; absent when there's nothing to choose. */
export function PrivacyChoicesLink({ className = "" }) {
  const { t } = useLingui();
  const { available, reopen } = useConsent();
  if (!available) return null;
  return (
    <button
      type="button"
      className={`font-semibold underline underline-offset-2 hover-fine:text-ink ${className}`}
      onClick={reopen}
    >
      {t`Privacy choices`}
    </button>
  );
}
