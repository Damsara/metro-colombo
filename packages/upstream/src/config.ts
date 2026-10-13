import { Config } from "effect";

export const LiveFeedConfig = Config.Literals(
  ["lankametro", "replay"],
  "LIVE_FEED",
);

export const LankaMetroConfig = Config.all({
  eimskyBase: Config.String("EIMSKY_BASE").pipe(
    Config.withDefault("https://metrobusapiprod.eimsky.com"),
  ),
  phone: Config.option(Config.String("METRO_PHONE")),
  seedRefreshToken: Config.option(Config.Redacted("METRO_REFRESH_TOKEN")),
});

export const ReplayConfig = Config.all({
  date: Config.String("REPLAY_DATE"),
  speed: Config.Number("REPLAY_SPEED").pipe(Config.withDefault(1)),
});

export const UpstreamKindConfig = Config.Literals(
  ["lankametro", "proxy"],
  "UPSTREAM",
);

export const ProxyConfig = Config.String("UPSTREAM_PROXY_URL");

export const ReferenceConfig = Config.all({
  lankametroBase: Config.String("LANKAMETRO_BASE").pipe(
    Config.withDefault("https://lankametro.lk"),
  ),
  occasionsIcsUrl: Config.String("OCCASIONS_ICS_URL").pipe(
    Config.withDefault(
      "https://ics.calendarlabs.com/517/c90b2261/Sri_Lanka_Holidays.ics",
    ),
  ),
});
