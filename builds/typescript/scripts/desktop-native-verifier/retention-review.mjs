import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const D4_BRANCHES = [
  "authorized_host_mediated_running_app",
  "denied_direct_storage_while_running",
  "denied_storage_while_stopped",
];

async function readablePath(candidate) {
  try {
    await access(candidate, constants.R_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function retentionFixtureState() {
  const root = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RETENTION_FIXTURE_ROOT?.trim();
  if (!root) {
    return {
      status: STATUS.BLOCKED,
      root: null,
      missing: ["D-3 incompatible retained-data fixture", "D-4 access-probe fixture/instrumentation"],
      basis: "The native verifier has no supplied incompatible-retained-data fixture or D-4 host access-probe authority.",
    };
  }

  const candidates = {
    incompatibleData: [
      `${root}/D-3/incompatible-retained-data`,
      `${root}/D-3-incompatible-retained-data`,
      `${root}/incompatible-retained-data`,
    ],
    accessProbe: [
      `${root}/D-4/access-probe`,
      `${root}/D-4-access-probe`,
      `${root}/access-probe`,
    ],
  };
  const found = {};
  for (const [name, paths] of Object.entries(candidates)) {
    found[name] = (await Promise.all(paths.map(readablePath))).find(Boolean) ?? null;
  }
  const missing = Object.entries(found).filter(([, value]) => !value).map(([name]) => name);
  return {
    status: missing.length === 0 ? STATUS.PASS : STATUS.BLOCKED,
    root,
    found,
    missing,
    basis: missing.length === 0
      ? "The D-3 incompatible-data and D-4 access-probe inputs are available to the native verifier."
      : `The retention fixture packet is incomplete: ${missing.join(", ")}.`,
  };
}

async function hostAccessTraceState() {
  const tracePath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_ACCESS_TRACE_PATH?.trim();
  if (!tracePath) {
    return {
      status: STATUS.BLOCKED,
      path: null,
      branches: D4_BRANCHES.map((branch) => ({ branch, status: "not_observed" })),
      basis: "The desktop host does not expose a D-4 access-trace artifact to this verifier run.",
    };
  }
  try {
    const parsed = JSON.parse(await readFile(tracePath, "utf8"));
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    const branches = D4_BRANCHES.map((branch) => {
      const record = Array.isArray(records) ? records.find((entry) => entry?.branch === branch) : null;
      return { branch, status: record ? "observed" : "not_observed", record: record ?? null };
    });
    const complete = branches.every((branch) => branch.status === "observed");
    return {
      status: complete ? STATUS.PASS : STATUS.BLOCKED,
      path: tracePath,
      branches,
      basis: complete
        ? "The supplied host access trace contains the authorized and both denied D-4 branches."
        : "The supplied host access trace does not contain all required D-4 branches.",
    };
  } catch (error) {
    return {
      status: STATUS.BLOCKED,
      path: tracePath,
      branches: D4_BRANCHES.map((branch) => ({ branch, status: "not_observed" })),
      basis: `The configured D-4 host access trace could not be read: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

/**
 * Review owner-data retention and the D-3/D-4 evidence contract. The live
 * uninstall/delete leg is evaluated from the isolated profile; fixture and
 * host-trace gaps remain blocked rather than being inferred from that leg.
 */
export async function reviewRetentionAndOwnerData({
  candidate = null,
  ownerData,
  deleteConfirmation,
  incompatibleMessage,
}) {
  const fixture = await retentionFixtureState();
  const accessTrace = await hostAccessTraceState();
  const retained = ownerData?.beforeUninstall?.sha256 && ownerData?.beforeUninstall?.sha256 === ownerData?.afterUninstall?.sha256;
  const cancelPreserved = ownerData?.beforeDeleteCancel?.sha256 && ownerData?.beforeDeleteCancel?.sha256 === ownerData?.afterDeleteCancel?.sha256;
  const confirmedDeleteChanged = ownerData?.afterUninstall?.sha256 && ownerData?.afterUninstall?.sha256 !== ownerData?.afterConfirmedDelete?.sha256;
  const rawActions = deleteConfirmation?.rawActions ?? [];
  const deleteClicks = rawActions.filter((action) => action.control === "Delete retained data");
  const cancelClicks = rawActions.filter((action) => action.control === "Cancel retained-data deletion");
  const deleteLegPass = Boolean(retained && cancelPreserved && confirmedDeleteChanged && deleteConfirmation?.namedApp
    && deleteClicks.length === 2 && deleteClicks.filter((action) => action.confirmation === true).length === 1 && cancelClicks.length === 1);
  const retentionPacketPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RETENTION_PACKET_PATH?.trim() ?? null;
  const retentionPublicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RETENTION_PUBLIC_KEY_PATH?.trim() ?? null;
  const retentionPacket = retentionPacketPath ? JSON.parse(await readFile(retentionPacketPath, "utf8").catch(() => "null")) : null;
  const retentionPublicKey = retentionPublicKeyPath ? await readFile(retentionPublicKeyPath, "utf8").catch(() => null) : null;
  const retentionIntegrity = retentionPacket
    ? await verifyExternalPacket(retentionPacket, { publicKeyPem: retentionPublicKey, candidate, fixturePath: fixture.root })
    : { valid: false, reason: "The signed D-3/D-4 retention packet is not supplied." };
  const incompatibleFixtureReady = fixture.status === STATUS.PASS && retentionIntegrity.valid && incompatibleMessage?.observed && incompatibleMessage?.hashUnchanged;
  const d4Pass = accessTrace.status === STATUS.PASS && accessTrace.branches.every((branch) => branch.status === "observed") && retentionIntegrity.valid;

  const tb2Basis = deleteLegPass
    ? "The isolated owner-data digest was unchanged by uninstall and cancel, then changed only after the separately confirmed retained-data deletion."
    : "The owner-data digest timeline did not yet prove retain-on-uninstall, cancel preservation, and change-after-confirmed-delete together.";
  const ac43Basis = deleteConfirmation?.namedApp && deleteConfirmation?.confirmed && cancelPreserved
    ? "Delete retained data named the app, required separate confirmation, and cancel preserved the owner-data digest."
    : "The retained-data delete confirmation or cancel-preservation evidence is incomplete.";

  const rows = {
    "AC-4.3": { status: deleteLegPass ? STATUS.PASS : STATUS.FAIL, basis: ac43Basis },
    "AC-5.2": { status: incompatibleFixtureReady ? STATUS.PASS : STATUS.BLOCKED, basis: incompatibleFixtureReady ? "The signed incompatible retained-data fixture displayed the safe incompatibility message without changing the owner-data digest." : `D-3 is not executable yet. ${fixture.basis} ${retentionIntegrity.reason ?? ""}` },
    "DC-5": { status: d4Pass ? STATUS.PASS : STATUS.BLOCKED, basis: d4Pass ? "The signed host access trace records the authorized mediated read/write and both denied direct/stopped probes with unchanged digest evidence." : `D-4 is not executable yet. ${accessTrace.basis} ${retentionIntegrity.reason ?? ""}` },
    "TB-2": { status: deleteLegPass ? STATUS.PASS : STATUS.FAIL, basis: tb2Basis },
  };

  return {
    review: "owner-data retention and access boundary",
    fixture,
    accessTrace,
    ownerData,
    incompatibleMessage: incompatibleMessage ?? { observed: false, hashUnchanged: false },
    retentionIntegrity,
    deleteConfirmation,
    rows,
    status: reviewStatus(rows),
  };
}
