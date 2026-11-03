import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmod, readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { candidateDigest, sha256 } from "./verification-contract.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function withoutSignature(packet) {
  const { signature: _signature, ...unsigned } = packet;
  return unsigned;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function signKatiePacket(packet, privateKey) {
  const unsigned = withoutSignature(packet);
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      payload_digest: `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`,
      value: sign(null, Buffer.from(canonical(unsigned)), privateKey).toString("base64"),
    },
  };
}

export function verifyKatiePacket(packet, publicKey) {
  if (packet?.signature?.algorithm !== "ed25519" || typeof packet.signature.value !== "string") return false;
  const unsigned = withoutSignature(packet);
  const payload = canonical(unsigned);
  return packet.signature.payload_digest === `sha256:${createHash("sha256").update(payload).digest("hex")}`
    && verify(null, Buffer.from(payload), publicKey, Buffer.from(packet.signature.value, "base64"));
}

async function digestTree(root, relative = "") {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const lines = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      lines.push(...await digestTree(root, child));
    } else if (entry.isFile()) {
      const content = await readFile(path.join(root, child));
      lines.push(`${child.replaceAll(path.sep, "/")}\0${sha256(content.toString("base64"))}`);
    }
  }
  return lines;
}

export async function digestPath(target) {
  const metadata = await stat(target);
  if (metadata.isFile()) return sha256((await readFile(target)).toString("base64"));
  if (!metadata.isDirectory()) throw new Error(`Digest target is not a file or directory: ${target}`);
  return sha256((await digestTree(target)).join("\n"));
}

/**
 * External packets are accepted only when they are signed and bound to both
 * the exact candidate and the supplied raw fixture root. Presence of a
 * `signed: true` flag is never evidence of a signature.
 */
export async function verifyExternalPacket(packet, {
  publicKeyPem,
  candidate,
  fixturePath,
} = {}) {
  if (!packet || !publicKeyPem || !fixturePath) return { valid: false, reason: "A signed packet, public key, candidate, and fixture path are required." };
  if (!verifyKatiePacket(packet, createPublicKey(publicKeyPem))) return { valid: false, reason: "The Ed25519 signature or payload digest is invalid." };
  if (packet.candidateDigest !== candidateDigest(candidate)) return { valid: false, reason: "The packet candidate digest does not match the candidate under test." };
  let actualFixtureDigest;
  try {
    actualFixtureDigest = await digestPath(fixturePath);
  } catch (error) {
    return { valid: false, reason: `The packet fixture root could not be digested: ${error.message}` };
  }
  if (packet.fixtureDigest !== actualFixtureDigest) return { valid: false, reason: "The packet fixture digest does not match the supplied raw fixture root." };
  return { valid: true, candidateDigest: packet.candidateDigest, fixtureDigest: actualFixtureDigest };
}

async function signKatie(inputPath, outputPath, privateKeyPath, publicKeyPath, candidatePath, fixtureRoot) {
  let privateKey;
  if (privateKeyPath) {
    privateKey = await readFile(privateKeyPath);
  } else {
    const generated = generateKeyPairSync("ed25519");
    privateKey = generated.privateKey.export({ type: "pkcs8", format: "pem" });
    privateKeyPath = `${outputPath}.ed25519-private.pem`;
    publicKeyPath ??= `${outputPath}.ed25519-public.pem`;
    await writeFile(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
    await writeFile(publicKeyPath, generated.publicKey.export({ type: "spki", format: "pem" }), { encoding: "utf8", mode: 0o644 });
  }
  const packet = await readJson(inputPath);
  if (!candidatePath || !fixtureRoot) throw new Error("sign-katie requires candidate.json and the raw fixture root after the key arguments.");
  const candidate = await readJson(candidatePath);
  packet.candidateDigest = candidateDigest(candidate);
  packet.fixtureDigest = await digestPath(fixtureRoot);
  const signed = signKatiePacket(packet, privateKey);
  await writeJson(outputPath, signed);
  await chmod(outputPath, 0o600);
  return { outputPath, privateKeyPath, publicKeyPath: publicKeyPath ?? null, verified: verifyKatiePacket(signed, createPublicKey(await readFile(publicKeyPath))) };
}

async function assembleAuthority(manifestPath, approvalPath, hostPath, outputPath) {
  const packet = {
    packetVersion: 1,
    manifest: await readJson(manifestPath),
    approval: await readJson(approvalPath),
    hostContract: await readJson(hostPath),
  };
  await writeJson(outputPath, packet);
  return { outputPath, manifest: manifestPath, approval: approvalPath, hostContract: hostPath };
}

async function signPacket(inputPath, outputPath, privateKeyPath, candidatePath, fixtureRoot) {
  if (!privateKeyPath) throw new Error("sign-packet requires an Ed25519 private key path.");
  const packet = await readJson(inputPath);
  if (!candidatePath || !fixtureRoot) throw new Error("sign-packet requires candidate.json and the raw fixture root after the key argument.");
  packet.candidateDigest = candidateDigest(await readJson(candidatePath));
  packet.fixtureDigest = await digestPath(fixtureRoot);
  const signed = signKatiePacket(packet, await readFile(privateKeyPath));
  await writeJson(outputPath, signed);
  await chmod(outputPath, 0o600);
  return { outputPath, privateKeyPath, verified: true };
}

function usage() {
  console.error("Usage:\n  packet-tools.mjs sign-katie <input.json> <output.json> <private-key.pem> <public-key.pem> <candidate.json> <fixture-root>\n  packet-tools.mjs sign-packet <input.json> <output.json> <private-key.pem> <candidate.json> <fixture-root>\n  packet-tools.mjs assemble-authority <manifest.json> <approval.json> <host-contract.json> <output.json>");
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "sign-katie" && args.length === 6) console.log(JSON.stringify(await signKatie(...args), null, 2));
    else if (command === "sign-packet" && args.length === 5) console.log(JSON.stringify(await signPacket(...args), null, 2));
    else if (command === "assemble-authority" && args.length === 4) console.log(JSON.stringify(await assembleAuthority(args[0], args[1], args[2], args[3]), null, 2));
    else usage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
