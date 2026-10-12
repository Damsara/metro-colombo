import { Context, Effect, Layer, Option } from "effect";
import { AlertConfig } from "./config.js";

export type Alert = {
  readonly title: string;
  readonly message: string;
  readonly urgent?: boolean;
};

export class Alerts extends Context.Service<
  Alerts,
  { readonly send: (alert: Alert) => Effect.Effect<void> }
>()("lmt-go/Alerts") {
  // Plain text with Title/Priority headers is ntfy's format; other webhooks still get the text.
  static readonly layer = Layer.effect(
    Alerts,
    Effect.gen(function* () {
      const { webhookUrl } = yield* AlertConfig;
      return Alerts.of({
        send: (alert) =>
          Option.match(webhookUrl, {
            onNone: () => Effect.logWarning(alert.title, alert.message),
            onSome: (url) =>
              Effect.tryPromise(() =>
                fetch(url, {
                  method: "POST",
                  headers: {
                    title: alert.title,
                    priority: alert.urgent ? "high" : "default",
                    tags: alert.urgent ? "rotating_light" : "white_check_mark",
                  },
                  body: alert.message,
                  signal: AbortSignal.timeout(10_000),
                }),
              ).pipe(
                Effect.flatMap((response) =>
                  response.ok
                    ? Effect.void
                    : Effect.logWarning("alert rejected", response.status),
                ),
                Effect.catch((error) =>
                  Effect.logWarning("alert not sent", error),
                ),
                Effect.andThen(Effect.logInfo(alert.title, alert.message)),
              ),
          }),
      });
    }),
  );
}
