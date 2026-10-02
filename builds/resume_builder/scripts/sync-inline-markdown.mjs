import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = new URL("../src/inline-markdown.ts", import.meta.url);
const shippedPath = new URL("../resources/inference-program.js", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll("export function ", "function ").trim();
const shipped = readFileSync(shippedPath, "utf8");
if ((shipped.match(/\/\/ inline-markdown:start/g) ?? []).length !== 1
  || (shipped.match(/\/\/ inline-markdown:end/g) ?? []).length !== 1) {
  throw new Error("Expected exactly one shipped inline grammar block");
}
const updated = shipped.replace(
  /(\/\/ inline-markdown:start[^\n]*\n)[\s\S]*?(\/\/ inline-markdown:end)/,
  (_, start, end) => `${start}${compiled}\n${end}`,
);
if (process.argv.includes("--check")) {
  if (updated !== shipped) throw new Error("Shipped inline grammar differs; run node scripts/sync-inline-markdown.mjs");
} else {
  writeFileSync(fileURLToPath(shippedPath), updated);
}
