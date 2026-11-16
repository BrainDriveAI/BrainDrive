import { buildPluginZip } from "./pluginZip";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

it("writes a ZIP whose entries hold the given files, in order, byte for byte", () => {
  const files: [string, string][] = [["plugin.json", "{\n  \"name\": \"garden\"\n}\n"], ["skills/garden/SKILL.md", "Grow things. Ünïcode stays."]];
  const zip = buildPluginZip(files);
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  let offset = 0;
  for (const [path, body] of files) {
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 8, true)).toBe(0); // stored, not compressed
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    expect(text(zip.subarray(offset + 30, offset + 30 + nameLength))).toBe(path);
    expect(text(zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size))).toBe(body);
    offset += 30 + nameLength + size;
  }
  expect(view.getUint32(end + 16, true)).toBe(offset); // central directory starts where the files end
});

it("records the standard CRC-32 of each file", () => {
  const zip = buildPluginZip([["a.txt", "hello"]]);
  expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0x3610a686);
});
