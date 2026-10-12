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
