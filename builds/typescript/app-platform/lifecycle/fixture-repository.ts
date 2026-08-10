import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, canonicalJsonDocumentDigest, canonicalSignedBytes } from "../contracts/common.js";
import type { z } from "zod";
import {
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  releaseKeyAuthorizationPayload,
  RevocationListSchema,
  TrustRootSchema,
} from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";
import { createStoredZip } from "./zip.js";

type Manifest = z.infer<typeof PackageManifestSchema>;
type Descriptor = z.infer<typeof PackageDescriptorSchema>;
type SourceIndex = z.infer<typeof PackageSourceIndexSchema>;
type Revocations = z.infer<typeof RevocationListSchema>;

export type FixtureRepository = {
  root: string;
  trustRootPath: string;
  sourceIndexPath: string;
  revocationListPath: string;
  packages: Record<string, { archivePath: string; descriptorPath: string }>;
  authoritiesByVersion?: Record<string, {
    trustRootPath: string;
    sourceIndexPath: string;
    revocationListPath: string;
  }>;
  signer?: (domain: string, payload: unknown) => string;
  releaseKeyId?: string;
};

export const MODERN_FIXTURE_VERSION = "3.2.1" as const;
export const MODERN_FIXTURE_CAPABILITIES = [
  "career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm",
  "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write",
  "resume.artifacts.register", "resume.export.request", "resume.operations.read", "app.inference.request",
] as const;

function loadResumeBuilderUi(): string {
  const candidates = [
    path.resolve(process.cwd(), "../resume_builder/resources/main.html"),
    fileURLToPath(new URL("../../../resume_builder/resources/main.html", import.meta.url)),
    fileURLToPath(new URL("../../../../resume_builder/resources/main.html", import.meta.url)),
  ];
  const resourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!resourcePath) throw new Error("Resume Builder UI package resource is missing");
  return readFileSync(resourcePath, "utf8");
}

const FIXTURE_SERVER = `import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const host = "127.0.0.1";
const port = Number((process.env.BRAINDRIVE_ENDPOINT_BIND || "127.0.0.1:0").split(":").at(-1));
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url === "/healthz") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({status:"ok", service:"fixture-mcp", app_id:process.env.BRAINDRIVE_APP_ID})); return; }
  if (request.url === "/mcp" && request.method === "POST") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:"2026-07-28",capabilities:{},serverInfo:{name:"fixture-mcp",version:"1.0.0"}}})); return; }
  response.writeHead(404).end();
});
server.listen(port, host, () => process.stdout.write(JSON.stringify({event:"fixture.ready"}) + "\\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
`;

function modernFixtureServer(appHtml: string, version: string): string {
  return `import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const host = "127.0.0.1";
const port = Number((process.env.BRAINDRIVE_ENDPOINT_BIND || "127.0.0.1:0").split(":").at(-1));
const appHtml = ${JSON.stringify(appHtml)};
const send = (response, id, result) => { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id,result})); };
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url === "/healthz") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({status:"ok",service:"fixture-mcp",app_id:process.env.BRAINDRIVE_APP_ID})); return; }
  if (request.url !== "/mcp" || request.method !== "POST") { response.writeHead(404).end(); return; }
  let body = "";
  request.on("data", (chunk) => { body += chunk; if (body.length > 262144) request.destroy(); });
  request.on("end", () => {
    let message;
    try { message = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
    if (message.method === "server/discover") { send(response, message.id, {supportedVersions:["2026-07-28"],capabilities:{tools:{listChanged:false},resources:{listChanged:false},extensions:{"io.modelcontextprotocol/ui":{mimeTypes:["text/html;profile=mcp-app"]}}},_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},"io.modelcontextprotocol/serverInfo":{name:"resume-builder-fixture",version:${JSON.stringify(version)}}}}); return; }
    if (message.method === "resources/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resources:[{uri:"ui://resume-builder/main",name:"Resume Builder",title:"Resume Builder",description:"Sandboxed owner resume workflow",mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "resources/templates/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resourceTemplates:[]}); return; }
    if (message.method === "resources/read" && message.params?.uri === "ui://resume-builder/main") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",contents:[{uri:"ui://resume-builder/main",mimeType:"text/html;profile=mcp-app",text:appHtml,_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "tools/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",tools:[{name:"fixture.status",description:"Return the fixture host status",inputSchema:{type:"object",properties:{},additionalProperties:false},_meta:{ui:{visibility:["app"]}}}]}); return; }
    if (message.method === "tools/call" && message.params?.name === "fixture.status") { send(response, message.id, {resultType:"complete",content:[{type:"text",text:"Fixture ready",annotations:{audience:["user"],priority:1}},{type:"resource_link",name:"resume-ui",uri:"ui://resume-builder/main",mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{visibility:"app"}},{type:"resource",resource:{uri:"ui://resume-builder/state",mimeType:"application/json",text:"{\\\"ready\\\":true}",_meta:{revision:1}}}],structuredContent:{ready:true,version:${JSON.stringify(version)}},_meta:{"io.modelcontextprotocol/ui":{resourceUri:"ui://resume-builder/main",visibility:["app"]}},isError:false}); return; }
    response.writeHead(404, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"Method not found"}}));
  });
});
server.listen(port, host, () => process.stdout.write(JSON.stringify({event:"fixture.ready"}) + "\\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
`;
}

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rawPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der).subarray(-32).toString("base64");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o644 });
}

export async function createFixtureRepository(root: string): Promise<FixtureRepository> {
  const legacy = await loadOrCreateFixtureSource(root, ["1.0.0", "2.0.0"], "legacy");
  const modernRoot = path.join(root, "modern");
  const priorModern = await loadPersistedFixtureSources(modernRoot, MODERN_FIXTURE_VERSION);
  const retainedModern = mergePersistedFixtureSources(priorModern);
  const modern = await loadOrCreateFixtureSource(path.join(modernRoot, MODERN_FIXTURE_VERSION), [MODERN_FIXTURE_VERSION], "modern");
  return {
    ...legacy,
    packages: { ...legacy.packages, ...retainedModern.packages, ...modern.packages },
    authoritiesByVersion: {
      ...retainedModern.authorities,
      [MODERN_FIXTURE_VERSION]: {
        trustRootPath: modern.trustRootPath,
        sourceIndexPath: modern.sourceIndexPath,
        revocationListPath: modern.revocationListPath,
      },
    },
  };
}

async function loadPersistedFixtureSources(root: string, currentVersion: string): Promise<FixtureRepository[]> {
  const repositories: FixtureRepository[] = [];
  const flatSource = await loadPersistedFixtureSource(root);
  if (flatSource) repositories.push(flatSource);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return repositories;
    throw error;
  }
  const versionDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name !== currentVersion && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of versionDirectories) {
    const repository = await loadPersistedFixtureSource(path.join(root, entry.name));
    if (repository) repositories.push(repository);
  }
  return repositories;
}

function mergePersistedFixtureSources(repositories: FixtureRepository[]): {
  packages: FixtureRepository["packages"];
  authorities: NonNullable<FixtureRepository["authoritiesByVersion"]>;
} {
  const packages: FixtureRepository["packages"] = {};
  const authorities: NonNullable<FixtureRepository["authoritiesByVersion"]> = {};
  for (const repository of repositories) {
    for (const [version, packagePaths] of Object.entries(repository.packages)) {
      if (packages[version]) {
        throw new AppPlatformError("source_index_signature_invalid", `Duplicate persisted fixture authority for Resume Builder ${version}`);
      }
      packages[version] = packagePaths;
      authorities[version] = {
        trustRootPath: repository.trustRootPath,
        sourceIndexPath: repository.sourceIndexPath,
        revocationListPath: repository.revocationListPath,
      };
    }
  }
  return { packages, authorities };
}

async function loadPersistedFixtureSource(root: string): Promise<FixtureRepository | null> {
  const sourceIndexPath = path.join(root, "source-index.json");
  try {
    const existing = PackageSourceIndexSchema.parse(JSON.parse(await readFile(sourceIndexPath, "utf8")));
    const packages = Object.fromEntries(existing.payload.entries.map((entry) => [entry.package_version, {
      archivePath: path.join(root, `${entry.package_version}.bdapp`),
      descriptorPath: path.join(root, `${entry.package_version}.descriptor.json`),
    }]));
    return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath: path.join(root, "revocations.json"), packages };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new AppPlatformError("source_index_signature_invalid", "Persisted fixture source index is malformed or unreadable");
  }
}

async function loadOrCreateFixtureSource(root: string, versions: string[], authorityLabel: "legacy" | "modern"): Promise<FixtureRepository> {
  const sourceIndexPath = path.join(root, "source-index.json");
  try {
    const existing = JSON.parse(await readFile(sourceIndexPath, "utf8")) as SourceIndex;
    const packages = Object.fromEntries(existing.payload.entries.map((entry) => [entry.package_version, {
      archivePath: path.join(root, `${entry.package_version}.bdapp`),
      descriptorPath: path.join(root, `${entry.package_version}.descriptor.json`),
    }]));
    return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath: path.join(root, "revocations.json"), packages };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new AppPlatformError("source_index_signature_invalid", "Persisted fixture source index is malformed or unreadable");
    }
    // Only a genuinely missing source initializes a synthetic authority.
  }
  await mkdir(root, { recursive: true });
  const rootPair = generateKeyPairSync("ed25519");
  const releasePair = generateKeyPairSync("ed25519");
  const rootKeyId = `braindrive-app-root-fixture-${authorityLabel}-2026`;
  const releaseKeyId = `braindrive-app-release-fixture-${authorityLabel}-2026`;
  const signWith = (privateKey: typeof rootPair.privateKey, domain: string, payload: unknown) =>
    sign(null, Buffer.from(canonicalSignedBytes(domain, payload), "utf8"), privateKey).toString("base64");
  const releaseSigner = (domain: string, payload: unknown) => signWith(releasePair.privateKey, domain, payload);
  const releaseKey = {
    key_version: 1 as const,
    key_id: releaseKeyId,
    algorithm: "ed25519" as const,
    public_key: rawPublicKey(releasePair.publicKey),
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: "2036-01-01T00:00:00.000Z",
    status: "active" as const,
    authorization: {
      signature_version: 1 as const,
      domain_separator: "BrainDrive-App-Release-Key-v1" as const,
      canonicalization: "braindrive-canonical-json-v1" as const,
      signature_algorithm: "ed25519" as const,
      signing_key_id: rootKeyId,
      signature: "",
    },
  };
  releaseKey.authorization.signature = signWith(rootPair.privateKey, releaseKey.authorization.domain_separator, releaseKeyAuthorizationPayload(releaseKey));
  const trustRoot = TrustRootSchema.parse({
    trust_root_version: 1,
    trust_domain: "braindrive-app-release",
    root_key: { key_id: rootKeyId, algorithm: "ed25519", public_key: rawPublicKey(rootPair.publicKey), status: "active" },
    threshold: 1,
    release_keys: [releaseKey],
  });
  await writeJson(path.join(root, "trust-root.json"), trustRoot);

  const packages: FixtureRepository["packages"] = {};
  const entries: SourceIndex["payload"]["entries"] = [];
  const modernFixtureHtml = authorityLabel === "modern" ? loadResumeBuilderUi() : null;
  const publishedAt = new Date().toISOString();
  const nextUpdateAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (const version of versions) {
    const files = new Map<string, Buffer>([
      ["payload/docker/index.js", Buffer.from(version === MODERN_FIXTURE_VERSION ? modernFixtureServer(modernFixtureHtml!, version) : FIXTURE_SERVER.replace('version:"1.0.0"', `version:"${version}"`), "utf8")],
      ...(version === MODERN_FIXTURE_VERSION ? [["payload/ui/main.html", Buffer.from(modernFixtureHtml!, "utf8")] as [string, Buffer]] : []),
      ["provenance/build.jsonl", Buffer.from(`${canonicalJson({ builder: "braindrive-fixture", version, source: "repository" })}\n`, "utf8")],
      ["sbom/cyclonedx.json", Buffer.from(`${canonicalJson({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components: [] })}\n`, "utf8")],
    ]);
    const manifest: Manifest = PackageManifestSchema.parse({
      manifest_version: 1,
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      display_name: "Resume Builder",
      package_version: version,
      archive: { format: "zip", profile: "braindrive-zip-v1", compression: "store", layout_version: 1, manifest_path: "manifest.json", undeclared_entries: "reject", links_and_device_nodes: "reject", max_file_count: 256, max_compressed_bytes: 67_108_864, max_uncompressed_bytes: 268_435_456 },
      files: [...files].map(([filePath, bytes]) => ({ path: filePath, kind: "file", mode: filePath.endsWith("/index.js") ? "executable" : "read_only", size_bytes: bytes.length, digest: digest(bytes) })),
      platform_artifacts: [
        { target: "docker_linux_x64", os: "linux", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/docker/index.js" },
        { target: "desktop_windows_x64", os: "windows", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/docker/index.js" },
      ],
      compatibility: { app_contract: 1, host_min_version: "26.7.23", mcp_protocol: "2026-07-28", legacy_mcp_adapter: "2025-11-25", mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" }, data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
      requested_capabilities: version === MODERN_FIXTURE_VERSION ? [...MODERN_FIXTURE_CAPABILITIES] : ["career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm", "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write", "resume.artifacts.register", "resume.export.request", "resume.operations.read", ...(version === "1.0.0" ? [] : ["app.inference.request" as const])],
      provenance_path: "provenance/build.jsonl",
      sbom_path: "sbom/cyclonedx.json",
      retention_policy: "retain_owner_data_remove_runtime_authority",
    });
    const archive = createStoredZip([
      { name: "manifest.json", bytes: Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"), executable: false },
      ...[...files].map(([name, bytes]) => ({ name, bytes, executable: name.endsWith("/index.js") })),
    ]);
    const archivePath = path.join(root, `${version}.bdapp`);
    await writeFile(archivePath, archive, { mode: 0o644 });
    const payload: Descriptor["payload"] = {
      descriptor_version: 1,
      manifest,
      manifest_digest: canonicalJsonDocumentDigest(manifest),
      archive: { media_type: "application/vnd.braindrive.app+zip", byte_length: archive.length, digest: digest(archive) },
      published_at: publishedAt,
    };
    const descriptor = PackageDescriptorSchema.parse({ payload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Package-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Package-v1", payload) } });
    const descriptorPath = path.join(root, `${version}.descriptor.json`);
    await writeJson(descriptorPath, descriptor);
    packages[version] = { archivePath, descriptorPath };
    entries.push({
      app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_version: version,
      descriptor_digest: canonicalJsonDocumentDigest(descriptor), archive_digest: digest(archive), targets: ["docker_linux_x64", "desktop_windows_x64"],
      sources: [
        { environment: "docker_dev", kind: "repository_fixture", descriptor_fixture_id: `resume-builder-${version}-descriptor`, archive_fixture_id: `resume-builder-${version}-archive` },
        { environment: "desktop_windows", kind: "release_https", descriptor_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.descriptor.json`, archive_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.bdapp` },
      ],
    });
  }
  const sourcePayload: SourceIndex["payload"] = { index_version: 1, sequence: 1, prior_index_digest: null, published_at: publishedAt, entries };
  const sourceIndex = PackageSourceIndexSchema.parse({ payload: sourcePayload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Source-Index-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Source-Index-v1", sourcePayload) } });
  await writeJson(sourceIndexPath, sourceIndex);
  const revocationPayload: Revocations["payload"] = { revocation_version: 1, sequence: 1, prior_list_digest: null, issued_at: publishedAt, next_update_at: nextUpdateAt, entries: [] };
  const revocations = RevocationListSchema.parse({ payload: revocationPayload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Revocations-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Revocations-v1", revocationPayload) } });
  const revocationListPath = path.join(root, "revocations.json");
  await writeJson(revocationListPath, revocations);
  return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath, packages, signer: releaseSigner, releaseKeyId };
}

export async function revokeFixtureVersion(repository: FixtureRepository, version: string): Promise<void> {
  if (!repository.signer || !repository.releaseKeyId) throw new Error("Fixture signing authority is unavailable after restart");
  const descriptor = PackageDescriptorSchema.parse(JSON.parse(await readFile(repository.packages[version].descriptorPath, "utf8")));
  const prior = RevocationListSchema.parse(JSON.parse(await readFile(repository.revocationListPath, "utf8")));
  const revokedAt = new Date().toISOString();
  const payload: Revocations["payload"] = {
    revocation_version: 1,
    sequence: prior.payload.sequence + 1,
    prior_list_digest: canonicalJsonDocumentDigest(prior.payload),
    issued_at: revokedAt,
    next_update_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    entries: [{ revocation_id: crypto.randomUUID(), publisher_id: "ai.braindrive", app_id: "ai.braindrive.resume-builder", match: { kind: "package_digest", package_digest: descriptor.payload.archive.digest }, reason_code: "critical_defect", revoked_at: revokedAt }],
  };
  const revocations = RevocationListSchema.parse({ payload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Revocations-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: repository.releaseKeyId, signature: repository.signer("BrainDrive-App-Revocations-v1", payload) } });
  await writeJson(repository.revocationListPath, revocations);
}
