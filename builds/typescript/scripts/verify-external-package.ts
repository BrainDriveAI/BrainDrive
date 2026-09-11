import path from "node:path";

import { PackageVerifier } from "../app-platform/lifecycle/package-verifier.js";
import type { FixtureRepository } from "../app-platform/lifecycle/fixture-repository.js";

type Options = {
  authorityRoot: string;
  version: string;
  packageId: string;
  publisherId: string;
  archive: string;
  descriptor: string;
};

const TARGETS = ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"] as const;

function usage(): never {
  console.error([
    "Usage: tsx scripts/verify-external-package.ts",
    "  --authority-root <path>",
    "  --version <semver>",
    "  --package-id <id>",
    "  --publisher-id <id>",
    "  --archive <archive.bdapp>",
    "  [--descriptor descriptor.json]",
  ].join("\n"));
  process.exit(2);
}

function readOptions(argv: string[]): Options {
  const options: Partial<Options> = { descriptor: "descriptor.json" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !value) usage();
    if (key === "--authority-root") options.authorityRoot = path.resolve(value);
    else if (key === "--version") options.version = value;
    else if (key === "--package-id") options.packageId = value;
    else if (key === "--publisher-id") options.publisherId = value;
    else if (key === "--archive") options.archive = value;
    else if (key === "--descriptor") options.descriptor = value;
    else usage();
  }
  if (!options.authorityRoot || !options.version || !options.packageId || !options.publisherId || !options.archive || !options.descriptor) usage();
  return options as Options;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const repository: FixtureRepository = {
    root: options.authorityRoot,
    trustRootPath: path.join(options.authorityRoot, "trust-root.json"),
    sourceIndexPath: path.join(options.authorityRoot, "source-index.json"),
    revocationListPath: path.join(options.authorityRoot, "revocations.json"),
    packages: {
      [options.version]: {
        archivePath: path.join(options.authorityRoot, options.archive),
        descriptorPath: path.join(options.authorityRoot, options.descriptor),
      },
    },
  };

  for (const target of TARGETS) {
    const verified = await new PackageVerifier("26.7.23", target).verifyForCatalog(repository, options.version, {
      appId: options.packageId,
      publisherId: options.publisherId,
    });
    console.log(`PASS ${target} ${verified.manifest.app_id}@${verified.manifest.package_version} ${verified.packageDigest}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL external package verification: ${message}`);
  process.exit(1);
});
