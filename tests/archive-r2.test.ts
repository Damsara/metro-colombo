import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { makeR2Store } from "../src/archive/r2.js";

const settings = {
  accountId: "acct",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "metro-data",
  publicUrl: "https://data.example.test",
};

const recording = (respond: (request: Request) => Response) => {
  const requests: Request[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  };
  return { requests, store: makeR2Store(settings, fetchImpl) };
};

test("uploads are signed for R2 and addressed path-style", async () => {
  const { requests, store } = recording(
    () => new Response(null, { status: 200 }),
  );
  await Effect.runPromise(
    store.put("raw/2026-10-12/001507-a.ndjson.gz", new Uint8Array([1, 2]), {
      contentType: "application/gzip",
      cacheControl: "public, max-age=60",
    }),
  );
  const [request] = requests;
  assert.equal(request.method, "PUT");
  assert.equal(
    request.url,
    "https://acct.r2.cloudflarestorage.com/metro-data/raw/2026-10-12/001507-a.ndjson.gz",
  );
  assert.match(
    request.headers.get("authorization") ?? "",
    /^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request/,
  );
  assert.equal(request.headers.get("content-type"), "application/gzip");
  assert.equal(request.headers.get("cache-control"), "public, max-age=60");
});

test("a failed upload is an ArchiveError with the status", async () => {
  const { store } = recording(() => new Response("nope", { status: 503 }));
  const error = await Effect.runPromise(
    Effect.flip(
      store.put("a", new Uint8Array(), { contentType: "text/plain" }),
    ),
  );
  assert.equal(error._tag, "ArchiveError");
  assert.equal(error.status, 503);
});

test("listing follows continuation tokens and unescapes keys", async () => {
  const pages = [
    "<ListBucketResult><Contents><Key>raw/2026-10-12/a&amp;b.gz</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken></ListBucketResult>",
    "<ListBucketResult><Contents><Key>raw/2026-10-12/c.gz</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
  ];
  const { requests, store } = recording(
    () => new Response(pages.shift(), { status: 200 }),
  );
  const keys = await Effect.runPromise(store.list("raw/2026-10-12/"));
  assert.deepEqual(keys, ["raw/2026-10-12/a&b.gz", "raw/2026-10-12/c.gz"]);
  const second = new URL(requests[1].url);
  assert.equal(second.searchParams.get("continuation-token"), "t1");
  assert.equal(second.searchParams.get("prefix"), "raw/2026-10-12/");
});

test("public reads go through the public domain without signing", async () => {
  const { requests, store } = recording(
    () => new Response("x", { status: 206 }),
  );
  const response = await Effect.runPromise(
    store.fetchPublic("catalog/metro.duckdb", { range: "bytes=0-9" }),
  );
  assert.equal(response.status, 206);
  assert.equal(
    requests[0].url,
    "https://data.example.test/catalog/metro.duckdb",
  );
  assert.equal(requests[0].headers.get("range"), "bytes=0-9");
  assert.equal(requests[0].headers.get("authorization"), null);
});
