import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const resourceRoot = path.resolve(scriptRoot, "..", "src-tauri", "desktop-runtime");

await mkdir(resourceRoot, { recursive: true });
console.log(`Prepared Tauri development resource directory at ${resourceRoot}`);
