import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AppResourceDescriptor } from "../contracts/app-registry.js";
import type { StoredPackage } from "../lifecycle/store.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import type { AppResourceReadResult } from "./app-host-types.js";

const MAX_OWNER_RESOURCE_BYTES = 65_536;

export async function readVerifiedPackageResource(
  storedPackage: StoredPackage,
  resource: AppResourceDescriptor,
): Promise<AppResourceReadResult> {
  const target = path.resolve(storedPackage.package_root, ...resource.package_path.split("/"));
  const root = path.resolve(storedPackage.package_root);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new AppPlatformError("package_path_invalid", "App package resource path escaped package authority", 403);
  }
  const bytes = await readFile(target);
  if (bytes.byteLength > MAX_OWNER_RESOURCE_BYTES) {
    throw new AppPlatformError("validation_failed", "App package resource exceeds the owner-view size limit", 413);
  }
  const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  if (contentDigest !== resource.content_digest) {
    throw new AppPlatformError("package_archive_digest_mismatch", "App package resource digest does not match descriptor", 409);
  }
  return {
    result_version: 1,
    resource_id: resource.resource_id,
    title: resource.title,
    description: resource.description,
    role: resource.role,
    media_type: resource.media_type,
    content_digest: contentDigest,
    owner_editable: resource.owner_editable,
    prompt_inclusion: resource.prompt_inclusion,
    content: bytes.toString("utf8"),
  };
}
