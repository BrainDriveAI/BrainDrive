#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VERSION_PATTERN = /^[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]+)?$/;

function parseArguments(argv) {
  let root = process.cwd();
  let mode = null;
  let version = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      root = path.resolve(argv[++index] || "");
    } else if (argument === "--write" || argument === "--check") {
      if (mode) throw new Error("Choose exactly one of --write or --check");
      mode = argument.slice(2);
      version = argv[++index] || "";
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: node installer/docker/scripts/normalize-release-version.mjs [--root <repository>] (--check|--write) <YY.M.D[.N]>\n"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!mode || !VERSION_PATTERN.test(version || "")) {
    throw new Error("A valid --check or --write YY.M.D[.N] version is required");
  }
  return { root, mode, version };
}

const targets = [
  ["builds/typescript/package.json", ["version"]],
  ["builds/typescript/package-lock.json", ["version"]],
  ["builds/typescript/package-lock.json", ["packages", "", "version"]],
  ["builds/typescript/client_web/package.json", ["version"]],
  ["builds/typescript/client_web/package-lock.json", ["version"]],
  ["builds/typescript/client_web/package-lock.json", ["packages", "", "version"]],
  ["builds/typescript/client_web/package-lock.json", ["packages", "..", "version"]],
  ["builds/typescript/src-tauri/tauri.conf.json", ["version"]],
];

function readNested(document, segments) {
  return segments.reduce((current, segment) => current?.[segment], document);
}

function writeNested(document, segments, value) {
  let current = document;
  for (const segment of segments.slice(0, -1)) {
    if (!current?.[segment] || typeof current[segment] !== "object") {
      throw new Error(`Missing version container: ${segments.join(".")}`);
    }
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

async function main() {
  const { root, mode, version } = parseArguments(process.argv.slice(2));
  const documents = new Map();
  let failed = false;

  for (const [relativePath, segments] of targets) {
    let document = documents.get(relativePath);
    if (!document) {
      document = JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
      documents.set(relativePath, document);
    }
    const current = readNested(document, segments);
    if (mode === "check") {
      if (current !== version) {
        process.stderr.write(`${relativePath} ${segments.join(".")} does not match ${version}\n`);
        failed = true;
      }
    } else {
      writeNested(document, segments, version);
    }
  }

  if (failed) process.exitCode = 1;
  if (mode === "write") {
    for (const [relativePath, document] of documents) {
      await writeFile(path.join(root, relativePath), `${JSON.stringify(document, null, 2)}\n`);
    }
    process.stdout.write(`Normalized app, web, lockfile, and Tauri versions to ${version}.\n`);
  } else if (!failed) {
    process.stdout.write(`App, web, lockfile, and Tauri versions match ${version}.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
