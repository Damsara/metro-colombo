import { env } from "cloudflare:workers";

export type TestEnv = {
  readonly ARCHIVE: R2Bucket;
  readonly PROBE: DurableObjectNamespace;
  readonly FLEET: DurableObjectNamespace;
  readonly OTP_SECRET: string;
};

export const testEnv = env as unknown as TestEnv;

export const probe = () => testEnv.PROBE.get(testEnv.PROBE.idFromName(crypto.randomUUID()));
