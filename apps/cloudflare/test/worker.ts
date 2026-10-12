export { StorageProbe } from "./storage-probe.ts";

export default {
  fetch: () => new Response("not found", { status: 404 }),
};
