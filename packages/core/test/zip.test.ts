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

test("more than 65535 entries are refused", async () => {
  const entries = Array.from({ length: 65536 }, (_, index) => ({
    name: String(index),
    bytes: new Uint8Array(),
  }));
  await assert.rejects(zip(entries), {
    message: "zip: more than 65535 entries",
  });
});

test("an entry name over 65535 UTF-8 bytes is refused", async () => {
  await assert.rejects(
    zip([{ name: "a".repeat(65536), bytes: new Uint8Array() }]),
    { message: "zip: entry name too long" },
  );
});

test("a name's UTF-8 length counts, not its string length", async () => {
  const name = "\u0d9a".repeat(21846);
  assert.equal(name.length, 21846);
  await assert.rejects(zip([{ name, bytes: new Uint8Array() }]), {
    message: "zip: entry name too long",
  });
});

test("duplicate entry names are refused", async () => {
  const entry = { name: "a.txt", bytes: utf8.encode("x") };
  await assert.rejects(zip([entry, entry]), {
    message: "zip: duplicate entry name",
  });
});

const tooBig = { message: "zip: archive exceeds 4 GiB (ZIP64 unsupported)" };

test("a raw size at the limit is refused", async () => {
  await assert.rejects(
    zip([{ name: "a", bytes: new Uint8Array(100) }], 100),
    tooBig,
  );
  await zip([{ name: "a", bytes: new Uint8Array(99) }], 100);
});

test("a compressed size at the limit is refused", async () => {
  const entry = { name: "a", bytes: new Uint8Array() };
  const compressed = new DataView((await zip([entry])).buffer).getUint32(
    18,
    true,
  );
  assert.equal(compressed, 2);
  await assert.rejects(zip([entry], compressed), tooBig);
});

test("a limit above 2^32 is clamped", async () => {
  const entry = { name: "a", bytes: utf8.encode("x") };
  assert.deepEqual(await zip([entry], 2 ** 40), await zip([entry]));
});

test("a running offset at the limit is refused", async () => {
  const entries = [
    { name: "a", bytes: utf8.encode("x") },
    { name: "b", bytes: utf8.encode("y") },
  ];
  await assert.rejects(zip(entries, 40), tooBig);
});

test("a central directory at the limit is refused", async () => {
  const entries = [
    { name: "a", bytes: new Uint8Array() },
    { name: "b", bytes: new Uint8Array() },
  ];
  await assert.rejects(zip(entries, 94), tooBig);
  await zip(entries, 95);
});

test("headers carry a zero time, the 1980 date and the UTF-8 flag", async () => {
  const archive = await zip([{ name: "කොළඹ", bytes: utf8.encode("x") }]);
  const view = new DataView(archive.buffer);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint16(10, true), 0);
  assert.equal(view.getUint16(12, true), 0x21);
  const central = view.getUint32(archive.length - 6, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  assert.equal(view.getUint16(central + 8, true), 0x0800);
  assert.equal(view.getUint16(central + 12, true), 0);
  assert.equal(view.getUint16(central + 14, true), 0x21);
});
