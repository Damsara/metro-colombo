import { Config } from "effect";

export const ApiConfig = Config.all({
  publicDataUrl: Config.String("PUBLIC_DATA_URL"),
});
