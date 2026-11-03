import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputRoot = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : path.join(process.cwd(), ".desktop-evaluation-fixtures"));

if (!outputRoot || outputRoot === path.parse(outputRoot).root) throw new Error("Refusing to write fixture material at a filesystem root");

const writeJson = async (name, value) => {
  const target = path.join(outputRoot, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return target;
};

const entries = Array.from({ length: 100 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  return {
    package_identity: {
      app_id: `ai.braindrive.cf-${number}`,
      display_name: `C-F Fixture App ${number}`,
      publisher_id: "ai.braindrive",
      package_version: "1.0.0",
    },
    safe_presentation: {
      display_name: `C-F Fixture App ${number}`,
      summary: `Synthetic browse-only catalog app ${number}.`,
      publisher_name: "BrainDrive",
      access_description: "Reads only the approved app data described on the approval screen.",
      change_note: "Initial reviewed fixture version.",
    },
  };
});

const files = {};
files["katie-capture.template.json"] = {
  status: "not_run",
  startedAt: null,
  openVisibleAt: null,
  informationBoundary: { signed: false, sources: ["forum post", "production client"] },
  path: [],
  note: "Capture on the native host, then sign this packet with packet-tools.mjs. Do not hand-edit a passing result.",
};
files["fault-observation.template.json"] = {
  status: "not_run",
  installFailures: { network: null, disk: null, restart: null, verification: null },
  updateActivation: null,
  note: "Each leg must be produced by a separate fresh-profile run with the desktop fault injector enabled; the injector may create failure but never recovery.",
};
files["tb5-manifest.template.json"] = { requested_capabilities: [], identity: { app_id: "", publisher_id: "", version: "" } };
files["tb5-approval.template.json"] = { access: [], observed: false };
files["tb5-host-contract.template.json"] = { allowed_capabilities: [] };
files["cf-browse-observation.template.json"] = {
  status: "not_run",
  packageDownloadRequests: null,
  packageNetworkCapture: null,
  manifestParity: [],
  note: "Populate from the host capture. Metadata-only catalog tracing cannot establish zero package downloads.",
};
files["cf-review-catalog.json"] = {
  fixtureId: "C-F",
  status: "not_run",
  entries,
  note: "This 100-entry metadata fixture exercises the review contract. A native run still requires a signed, target-compatible catalog and package-manifest parity packet.",
};

for (const [name, value] of Object.entries(files)) await writeJson(name, value);
const manifest = {
  fixturePackVersion: 1,
  status: "not_run",
  generatedAt: new Date().toISOString(),
  platformRuns: ["windows", "macos"],
  requiredInputs: {
    katie: ["katie-capture.template.json", "signed Katie packet", "public Ed25519 key"],
    f1: ["fault-observation.template.json", "F-1 fault fixture root", "four fresh-profile fault runs", "one update-activation run"],
    tb5: ["tb5-manifest.template.json", "tb5-approval.template.json", "tb5-host-contract.template.json"],
    cf: ["cf-review-catalog.json", "signed target-compatible C-F catalog", "cf-browse-observation.template.json", "package network capture", "manifest parity records"],
  },
  requiredRows: {
    requiredBeforeFormalVerdict: [
      "AC-1.1–AC-1.7", "AC-2.1–AC-2.4", "AC-3.1–AC-3.6", "AC-4.1–AC-5.2", "AC-6.1–AC-6.4",
      "AC-8.1–AC-8.6", "AC-9.1–AC-9.6", "CF-1–CF-8", "TB-1–TB-6", "FR-1–FR-10", "DC-1–DC-5", "IF-1–IF-3", "NG-1–NG-2",
    ],
    rule: "Run independently on Windows and macOS; evidence never transfers between hosts.",
  },
};
await writeJson("fixture-manifest.json", manifest);
console.log(JSON.stringify({ outputRoot, files: [...Object.keys(files), "fixture-manifest.json"], entries: entries.length, status: manifest.status }, null, 2));
