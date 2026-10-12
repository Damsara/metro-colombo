import { Container, getContainer } from "@cloudflare/containers";

type Env = { COMPACTOR: DurableObjectNamespace<Compactor>; SPIKE_KEY?: string };

export class Compactor extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "2m";
}

async function run(env: Env) {
  const started = Date.now();
  const response = await getContainer(env.COMPACTOR, "compactor").fetch("http://container/run");
  return `${await response.text()} wallMs=${Date.now() - started}`;
}

export default {
  fetch(request: Request, env: Env) {
    if (!env.SPIKE_KEY || request.headers.get("x-spike-key") !== env.SPIKE_KEY)
      return new Response("not found", { status: 404 });
    return run(env).then((body) => new Response(body));
  },
  async scheduled(_event: ScheduledController, env: Env) {
    console.log("cron result", await run(env));
  },
};
