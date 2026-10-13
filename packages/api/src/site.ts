import { Layer } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/http";
import { FleetRoutes } from "@metro/fleet";
import { CatalogRoutes } from "./catalog.js";
import { JourneyRoutes } from "./journey.js";
import { ReferenceReader } from "./reader.js";
import { ReferenceRoutes } from "./reference-routes.js";
import { StatusRoutes } from "./status-routes.js";

const Untraced = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
  (request) =>
    request.url.startsWith("/api/health") ||
    request.url.startsWith("/api/live"),
);

export const SiteRoutes = Layer.mergeAll(
  ReferenceRoutes,
  StatusRoutes,
  JourneyRoutes,
  CatalogRoutes,
  FleetRoutes,
  HttpRouter.cors({ allowedMethods: ["GET"] }),
  Untraced,
).pipe(Layer.provide(ReferenceReader.layer));
