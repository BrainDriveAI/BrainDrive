// PROTOTYPE ONLY: writes a plain (uncompressed) ZIP of text files in the browser, so "Save as a
// plugin" in the Experts prototype hands the owner a real plugin file. Nothing is sent anywhere.

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(signature: number, fields: number[], sizes: number[]): Uint8Array {
  const bytes = new Uint8Array(4 + sizes.reduce((sum, size) => sum + size, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  let offset = 4;
  fields.forEach((field, index) => {
    if (sizes[index] === 2) view.setUint16(offset, field, true); else view.setUint32(offset, field, true);
    offset += sizes[index]!;
  });
  return bytes;
}

/** Builds a ZIP holding the given text files, in the order given, stored without compression. */
export function buildPluginZip(files: [path: string, text: string][]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(text);
    const crc = crc32(data);
    // version, flags (UTF-8 names), method (stored), time, date, crc, sizes, name length, extra length
    const shared = [20, 0x0800, 0, 0, 0x21, crc, data.length, data.length, name.length, 0];
    const sharedSizes = [2, 2, 2, 2, 2, 4, 4, 4, 2, 2];
    const localHeader = header(0x04034b50, shared, sharedSizes);
    local.push(localHeader, name, data);
    central.push(header(0x02014b50, [20, ...shared, 0, 0, 0, 0, offset], [2, ...sharedSizes, 2, 2, 2, 4, 4]), name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(0x06054b50, [0, 0, files.length, files.length, centralSize, offset, 0], [2, 2, 2, 2, 4, 4, 2]);
  const parts = [...local, ...central, end];
  const zip = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { zip.set(part, position); position += part.length; }
  return zip;
}

/** Hands the ZIP to the browser as a download. Does nothing where the browser cannot (tests). */
export function downloadPluginZip(fileName: string, files: [path: string, text: string][]) {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([buildPluginZip(files) as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
