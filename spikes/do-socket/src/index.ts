import { DurableObject } from "cloudflare:workers";

type Env = { PROBE: DurableObjectNamespace<Probe> };

const ECHO_URL = "https://echo.websocket.org";
const ALARM_MS = 5_000;
const COUNTERS = ["alarms", "received", "drops", "opens", "openFailures", "constructions"] as const;
type Counter = (typeof COUNTERS)[number];

export class Probe extends DurableObject<Env> {
  socket: WebSocket | null = null;
  lastMessageAt: number | null = null;
  lastError: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      await this.bump("constructions");
    });
  }

  async bump(name: Counter) {
    const value = ((await this.ctx.storage.get<number>(name)) ?? 0) + 1;
    await this.ctx.storage.put(name, value);
  }

  async open() {
    const response = await fetch(ECHO_URL, { headers: { Upgrade: "websocket" } });
    const socket = response.webSocket;
    if (!socket) throw new Error(`no socket, status ${response.status}`);
    socket.accept();
    socket.addEventListener("message", async () => {
      this.lastMessageAt = Date.now();
      await this.bump("received");
    });
    const dropped = async () => {
      if (this.socket !== socket) return;
      this.socket = null;
      await this.bump("drops");
    };
    socket.addEventListener("close", dropped);
    socket.addEventListener("error", dropped);
    this.socket = socket;
    await this.bump("opens");
  }

  async alarm() {
    if (!this.socket) {
      try {
        await this.open();
      } catch (error) {
        this.lastError = String(error);
        await this.bump("openFailures");
      }
    }
    this.socket?.send("ping");
    await this.bump("alarms");
    await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
  }

  async start() {
    await this.ctx.storage.put("startedAt", Date.now());
    await this.ctx.storage.setAlarm(Date.now() + 1_000);
  }

  async stats() {
    const counters = Object.fromEntries(
      await Promise.all(
        COUNTERS.map(async (name) => [name, (await this.ctx.storage.get<number>(name)) ?? 0] as const),
      ),
    );
    return {
      startedAt: (await this.ctx.storage.get<number>("startedAt")) ?? null,
      now: Date.now(),
      ...counters,
      connected: this.socket !== null,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      nextAlarm: await this.ctx.storage.getAlarm(),
    };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const probe = env.PROBE.get(env.PROBE.idFromName("probe"));
    const path = new URL(request.url).pathname;
    if (path === "/start") await probe.start();
    return Response.json(await probe.stats());
  },
};
