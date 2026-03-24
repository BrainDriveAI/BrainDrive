import { auditLog } from "../logger.js";
import {
  generateMasterKey,
  initializeMasterKey,
  loadMasterKey,
  writeMasterKeyFile,
} from "./key-provider.js";
import { resolveSecretsPaths } from "./paths.js";
import { promptForSecretInput } from "./prompt.js";
import {
  deleteVaultSecret,
  listVaultSecretRefs,
  loadSecretVault,
  rotateVaultSecrets,
  upsertVaultSecret,
} from "./vault.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];

  switch (command) {
    case "init":
      await runInit(parsed.options);
      return;
    case "set":
      await runSet(parsed.positionals.slice(1), parsed.options);
      return;
    case "status":
      await runStatus();
      return;
    case "rotate-key":
      await runRotateKey(parsed.options);
      return;
    case "delete":
      await runDelete(parsed.positionals.slice(1));
      return;
    default:
      printUsage();
      process.exitCode = 1;
      return;
  }
}

async function runInit(options: Map<string, string | true>): Promise<void> {
  const paths = resolveSecretsPaths();
  const keyId = valueFromOption(options, "--key-id");
  const force = options.has("--force");
  const result = await initializeMasterKey({ keyId, force, paths });

  auditLog("secret.init", {
    key_id: result.keyId,
    key_path: result.path,
    created: result.created,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.created ? "created" : "existing",
        key_id: result.keyId,
        key_path: result.path,
      },
      null,
      2
    )}\n`
  );
}

async function runSet(positionals: string[], options: Map<string, string | true>): Promise<void> {
  const secretRef = positionals[0]?.trim();
  if (!secretRef) {
    throw new Error("Usage: secrets set <secret-ref> [--value <value>]");
  }

  const providedValue = valueFromOption(options, "--value");
  const value = providedValue ?? (await promptForSecretInput(`Enter value for ${secretRef}: `));
  if (!value || value.trim().length === 0) {
    throw new Error("Secret value cannot be empty");
  }

  const paths = resolveSecretsPaths();
  const masterKey = await loadMasterKey(paths);
  await upsertVaultSecret(secretRef, value, masterKey, paths);

  auditLog("secret.set", {
    secret_ref: secretRef,
    source: masterKey.source,
    vault_path: paths.vaultPath,
    key_id: masterKey.keyId,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        action: "set",
        secret_ref: secretRef,
        vault_path: paths.vaultPath,
      },
      null,
      2
    )}\n`
  );
}

async function runStatus(): Promise<void> {
  const paths = resolveSecretsPaths();
  const vault = await loadSecretVault(paths);
  const refs = await listVaultSecretRefs(paths);

  let keyStatus: {
    status: "ok";
    source: string;
    key_id: string;
    key_path?: string;
  } | {
    status: "missing";
    message: string;
  };
  try {
    const key = await loadMasterKey(paths);
    keyStatus = {
      status: "ok",
      source: key.source,
      key_id: key.keyId,
      key_path: key.path,
    };
  } catch (error) {
    keyStatus = {
      status: "missing",
      message: error instanceof Error ? error.message : "Unknown key error",
    };
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        vault_path: paths.vaultPath,
        key_path: paths.keyPath,
        schema_version: vault.schema_version,
        entry_count: refs.length,
        secret_refs: refs,
        key: keyStatus,
      },
      null,
      2
    )}\n`
  );
}

async function runRotateKey(options: Map<string, string | true>): Promise<void> {
  const paths = resolveSecretsPaths();
  const currentMasterKey = await loadMasterKey(paths);
  if (currentMasterKey.source !== "file") {
    throw new Error("rotate-key requires a file-managed master key (unset PAA_SECRETS_MASTER_KEY_B64 and retry)");
  }

  const nextKeyId = valueFromOption(options, "--key-id") ?? `owner-master-${new Date().toISOString()}`;
  const nextMasterKey = {
    keyId: nextKeyId,
    key: generateMasterKey(),
    source: "file" as const,
    path: paths.keyPath,
  };

  const result = await rotateVaultSecrets(currentMasterKey, nextMasterKey, paths);
  await writeMasterKeyFile(paths, nextMasterKey.keyId, nextMasterKey.key);

  auditLog("secret.rotate_key", {
    from_key_id: currentMasterKey.keyId,
    to_key_id: nextMasterKey.keyId,
    rotated_entries: result.rotated,
    key_path: paths.keyPath,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        action: "rotate-key",
        from_key_id: currentMasterKey.keyId,
        to_key_id: nextMasterKey.keyId,
        rotated_entries: result.rotated,
      },
      null,
      2
    )}\n`
  );
}

async function runDelete(positionals: string[]): Promise<void> {
  const secretRef = positionals[0]?.trim();
  if (!secretRef) {
    throw new Error("Usage: secrets delete <secret-ref>");
  }

  const paths = resolveSecretsPaths();
  const deleted = await deleteVaultSecret(secretRef, paths);
  auditLog("secret.delete", {
    secret_ref: secretRef,
    deleted,
    vault_path: paths.vaultPath,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: deleted ? "ok" : "missing",
        action: "delete",
        secret_ref: secretRef,
      },
      null,
      2
    )}\n`
  );
}

function parseArgs(argv: string[]): { positionals: string[]; options: Map<string, string | true> } {
  const options = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      options.set(token, true);
      continue;
    }

    options.set(token, nextToken);
    index += 1;
  }

  return { positionals, options };
}

function valueFromOption(options: Map<string, string | true>, key: string): string | undefined {
  const value = options.get(key);
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  npm run secrets -- init [--key-id <id>] [--force]",
      "  npm run secrets -- set <secret-ref> [--value <value>]",
      "  npm run secrets -- status",
      "  npm run secrets -- rotate-key [--key-id <id>]",
      "  npm run secrets -- delete <secret-ref>",
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  auditLog("secret.cli_error", {
    message: error instanceof Error ? error.message : "Unknown secrets CLI error",
  });
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
});
