const BASE = "https://metrobusapiprod.eimsky.com";
const REVEALING = [
  "server",
  "cf-ray",
  "cf-cache-status",
  "cf-mitigated",
  "x-amzn-requestid",
  "x-cache",
  "via",
  "content-type",
];

const pick = (headers: Headers) =>
  Object.fromEntries(
    REVEALING.flatMap((name) =>
      headers.has(name) ? [[name, headers.get(name)]] : [],
    ),
  );

const timed = async (call: () => Promise<Record<string, unknown>>) => {
  const started = Date.now();
  try {
    return { ...(await call()), ms: Date.now() - started };
  } catch (error) {
    return { error: String(error), ms: Date.now() - started };
  }
};

export default {
  async fetch(request: Request, env: { SPIKE_KEY?: string }): Promise<Response> {
    if (!env.SPIKE_KEY || request.headers.get("x-spike-key") !== env.SPIKE_KEY)
      return new Response("not found", { status: 404 });
    const refresh = await timed(async () => {
      const response = await fetch(`${BASE}/user-service/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: "spike-invalid" }),
        signal: AbortSignal.timeout(15_000),
      });
      return {
        status: response.status,
        headers: pick(response.headers),
        body: (await response.text()).slice(0, 300),
      };
    });
    const socket = await timed(async () => {
      const response = await fetch(`${BASE}/ticketing-service/ws`, {
        headers: { Upgrade: "websocket", origin: "https://lmtgo.eimsky.com" },
        signal: AbortSignal.timeout(15_000),
      });
      const upgraded = response.webSocket !== null;
      if (response.webSocket) {
        response.webSocket.accept();
        response.webSocket.close(1000, "spike");
      }
      return {
        status: response.status,
        upgraded,
        headers: pick(response.headers),
        body: upgraded ? "" : (await response.text()).slice(0, 300),
      };
    });
    return Response.json({ refresh, socket });
  },
};
