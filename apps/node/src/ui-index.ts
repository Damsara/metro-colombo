import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/http";
import { UiIndex } from "@metro/api";

export const nodeUiIndex = (webDist: string) =>
  Layer.effect(
    UiIndex,
    Effect.promise(() =>
      readFile(join(webDist, "index.html"), "utf8").catch(() => undefined),
    ).pipe(
      Effect.map((html) =>
        UiIndex.of({
          response: Effect.sync(() =>
            html === undefined
              ? HttpServerResponse.text(
                  "The web app isn't built on this server.",
                  {
                    status: 404,
                    headers: { "cache-control": "no-store" },
                  },
                )
              : HttpServerResponse.text(html, { contentType: "text/html" }),
          ),
        }),
      ),
    ),
  );
