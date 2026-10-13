import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { FleetRoutes } from "@metro/fleet";
import { CatalogRoutes } from "./catalog.js";
import { JourneyRoutes } from "./journey.js";
import { ReferenceReader } from "./reader.js";
import { ReferenceRoutes } from "./reference-routes.js";
import { StatusRoutes } from "./status-routes.js";

export const SiteRoutes = Layer.mergeAll(
  ReferenceRoutes,
  StatusRoutes,
  JourneyRoutes,
  CatalogRoutes,
  FleetRoutes,
  HttpRouter.cors({ allowedMethods: ["GET"] }),
).pipe(Layer.provide(ReferenceReader.layer));
