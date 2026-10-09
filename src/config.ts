import { Config, Redacted } from "effect";

// The official tracker's public reader token; see "Quick start" in the README.
const PUBLIC_READER_TOKEN =
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiODA5MDM3NGEtMjc0YS00MzlmLWI4M2QtMDJjZDJkMDFmMzZhIiwiZW1haWwiOiJtaXRodXNoYWlkQGdtYWlsLmNvbSIsInVzZXJfdHlwZSI6ImN1c3RvbWVyIiwidG9rZW5faWQiOiI2OTQ2Nzk5ZS0wZTNhLTRiNzQtYTJlNy0xMGNmNTk5NGZjNmEiLCJpc3MiOiJudGMtdXNlci1zZXJ2aWNlIiwic3ViIjoiODA5MDM3NGEtMjc0YS00MzlmLWI4M2QtMDJjZDJkMDFmMzZhIiwiYXVkIjpbIm50Yy1hcGkiXSwiZXhwIjoxODE3NDQ4MDk1LCJuYmYiOjE3ODU5MTIwOTUsImlhdCI6MTc4NTkxMjA5NX0.WSRP_0HwWX8L83p2KkQahUeEHUgsAdz8PNjFz83op4xk38-QH5f_iEOtYFxxN1EhYtHLkNO-uiaJM3qoDuC1CQ";

export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(8788)),
  host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1")),
  webDist: Config.String("WEB_DIST").pipe(Config.withDefault("web/dist")),
});

export const UpstreamConfig = Config.all({
  eimskyBase: Config.String("EIMSKY_BASE").pipe(
    Config.withDefault("https://metrobusapiprod.eimsky.com"),
  ),
  lankametroBase: Config.String("LANKAMETRO_BASE").pipe(
    Config.withDefault("https://lankametro.lk"),
  ),

  token: Config.Redacted("METRO_API_TOKEN").pipe(
    Config.withDefault(Redacted.make(PUBLIC_READER_TOKEN)),
  ),
});
