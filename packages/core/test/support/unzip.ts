import assert from "node:assert/strict";

const inflate = async (bytes: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(bytes)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );

export const unzip = async (archive: Uint8Array) => {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const end = archive.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, { bytes: Uint8Array; crc: number }>();
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 10, true), 8);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      archive.subarray(at + 46, at + 46 + nameLength),
    );
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const start =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    const bytes = await inflate(archive.subarray(start, start + compressed));
    assert.equal(bytes.length, size);
    files.set(name, { bytes, crc });
    at += 46 + nameLength + extra + comment;
  }
  return files;
};
