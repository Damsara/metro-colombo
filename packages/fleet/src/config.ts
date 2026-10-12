import { Config } from "effect";

export const FleetConfig = Config.all({
  instance: Config.String("FLEET_INSTANCE").pipe(Config.withDefault("fleet")),
  alertWebhookUrl: Config.option(Config.String("ALERT_WEBHOOK_URL")),
  otpSecret: Config.option(Config.Redacted("OTP_SECRET")),
});
