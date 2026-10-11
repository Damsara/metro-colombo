import { createFileRoute } from "@tanstack/react-router";
import DataDocs from "../DataDocs";

export const Route = createFileRoute("/data")({
  component: DataDocs,
});
