import { Config } from "effect";

export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8788)),
  host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1")),
  webDist: Config.String("WEB_DIST").pipe(Config.withDefault("web/dist")),
});

export const OccasionsConfig = Config.all({
  icsUrl: Config.String("OCCASIONS_ICS_URL").pipe(
    Config.withDefault(
      "https://ics.calendarlabs.com/517/c90b2261/Sri_Lanka_Holidays.ics",
    ),
  ),
});

export const UpstreamConfig = Config.all({
  eimskyBase: Config.String("EIMSKY_BASE").pipe(
    Config.withDefault("https://metrobusapiprod.eimsky.com"),
  ),
  lankametroBase: Config.String("LANKAMETRO_BASE").pipe(
    Config.withDefault("https://lankametro.lk"),
  ),

  // One-time seed from scripts/otp-login.mjs; Auth auto-renews from it.
  refreshToken: Config.option(Config.Redacted("METRO_REFRESH_TOKEN")),
  authStatePath: Config.String("AUTH_STATE_PATH").pipe(
    Config.withDefault(".auth-state"),
  ),
});
