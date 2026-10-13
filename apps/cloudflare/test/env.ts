import { env } from "cloudflare:workers";

export type TestEnv = {
  readonly ARCHIVE: R2Bucket;
  readonly PROBE: DurableObjectNamespace;
  readonly FLEET: DurableObjectNamespace;
  readonly OTP_SECRET: string;
};

export const testEnv = env as unknown as TestEnv;

export const probe = () =>
  testEnv.PROBE.get(testEnv.PROBE.idFromName(crypto.randomUUID()));

// R2 is shared by every test in a file, and the suite expects each test to start with an empty store.
export const emptyArchive = async () => {
  for (
    let listed = await testEnv.ARCHIVE.list();
    listed.objects.length > 0;
    listed = await testEnv.ARCHIVE.list()
  ) {
    await testEnv.ARCHIVE.delete(listed.objects.map((object) => object.key));
  }
};
