import { Container, getContainer } from "@cloudflare/containers";

type Env = { COMPACTOR: DurableObjectNamespace<Compactor> };

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
  fetch(_request: Request, env: Env) {
    return run(env).then((body) => new Response(body));
  },
  async scheduled(_event: ScheduledController, env: Env) {
    console.log("cron result", await run(env));
  },
};
