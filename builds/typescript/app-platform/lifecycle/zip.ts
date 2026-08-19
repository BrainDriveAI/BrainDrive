import path from "node:path";

import { AppPlatformError } from "./errors.js";

export type ZipEntry = { name: string; bytes: Buffer; executable: boolean };

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.executable ? 0o100755 : 0o100444) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBytes, end]);
}

export function readStoredZip(archive: Buffer): ZipEntry[] {
  if (archive.length > 67_108_864) throw new AppPlatformError("package_oversized", "Package archive exceeds the accepted byte ceiling");
  const entries: ZipEntry[] = [];
  let offset = 0;
  let totalBytes = 0;
  const names = new Set<string>();
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (entries.length >= 256 || offset + 30 > archive.length) throw new AppPlatformError("package_archive_invalid", "ZIP entry limit or header is invalid");
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const crc = archive.readUInt32LE(offset + 14);
    const compressed = archive.readUInt32LE(offset + 18);
    const uncompressed = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    if (flags !== 0x0800 || method !== 0 || compressed !== uncompressed || extraLength !== 0) {
      throw new AppPlatformError("package_archive_invalid", "ZIP must use the canonical uncompressed profile");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength;
    const dataEnd = dataStart + compressed;
    if (dataEnd > archive.length) throw new AppPlatformError("package_archive_invalid", "ZIP entry exceeds archive bounds");
    const name = archive.subarray(nameStart, dataStart).toString("utf8");
    if (!name || path.posix.normalize(name) !== name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      throw new AppPlatformError("package_path_invalid", "ZIP entry path is unsafe");
    }
    const folded = name.toLowerCase();
    if (names.has(folded)) throw new AppPlatformError("duplicate_identity", "ZIP entry identity is duplicated or case-colliding");
    names.add(folded);
    const bytes = Buffer.from(archive.subarray(dataStart, dataEnd));
    if (crc32(bytes) !== crc) throw new AppPlatformError("package_archive_invalid", "ZIP entry checksum is invalid");
    totalBytes += bytes.length;
    if (totalBytes > 268_435_456) throw new AppPlatformError("package_oversized", "Package expands beyond the accepted byte ceiling");
    entries.push({ name, bytes, executable: false });
    offset = dataEnd;
  }
  if (entries.length === 0 || offset + 4 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
    throw new AppPlatformError("package_archive_invalid", "ZIP central directory is missing");
  }
  return entries;
}
