import { createFileRoute } from "@tanstack/react-router";
import ApiDocs from "../ApiDocs";

export const Route = createFileRoute("/docs")({
  component: ApiDocs,
});
