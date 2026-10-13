import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, zip } from "@metro/core";
import { unzip } from "./support/unzip.ts";

const utf8 = new TextEncoder();

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(utf8.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("a zip round-trips every entry, including UTF-8 names and an empty file", async () => {
  const entries = [
    { name: "agency.txt", bytes: utf8.encode("agency_id\r\nLMT\r\n") },
    { name: "කොළඹ.txt", bytes: utf8.encode("නෙළුම් පොකුණ\r\n".repeat(50)) },
    { name: "empty.txt", bytes: new Uint8Array() },
  ];
  const files = await unzip(await zip(entries));
  assert.deepEqual(
    [...files.keys()],
    entries.map((entry) => entry.name),
  );
  for (const entry of entries) {
    const found = files.get(entry.name);
    assert.ok(found);
    assert.deepEqual(found.bytes, entry.bytes);
    assert.equal(found.crc, crc32(entry.bytes));
  }
});

test("the same entries give the same bytes", async () => {
  const entries = [{ name: "a.txt", bytes: utf8.encode("same") }];
  assert.deepEqual(await zip(entries), await zip(entries));
});

test("an archive with no entries is just the end record", async () => {
  const archive = await zip([]);
  assert.equal(archive.length, 22);
  assert.equal(new DataView(archive.buffer).getUint32(0, true), 0x06054b50);
});
