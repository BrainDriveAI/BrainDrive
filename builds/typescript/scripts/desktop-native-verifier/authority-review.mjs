import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

function row(status, basis) {
  return { status, basis };
}

async function readPacket() {
  const packetPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_TB5_AUTHORITY_PATH?.trim() ?? null;
  if (!packetPath) return { status: STATUS.BLOCKED, path: null, packet: null, basis: "The signed TB-5 manifest/approval/Host authority packet is not supplied." };
  try {
    await access(packetPath, constants.R_OK);
    return { status: STATUS.PASS, path: packetPath, packet: JSON.parse(await readFile(packetPath, "utf8")), basis: "The TB-5 packet is readable." };
  } catch (error) {
    return { status: STATUS.FAIL, path: packetPath, packet: null, basis: `The TB-5 packet is not valid readable JSON: ${error.message}` };
  }
}

function values(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "string" ? entry : entry.operation_id ?? entry.capability ?? entry.name).filter(Boolean).map(String).sort();
}

/** Review TB-5's declared-capability boundary from a signed packet and raw approval event. */
export async function reviewAuthorityBoundary({ candidate = null, approvalDialogs = [], lifecycleEvents = [] } = {}) {
  const fixture = await readPacket();
  if (fixture.status !== STATUS.PASS) {
    const rows = { "TB-5": row(fixture.status, fixture.basis) };
    return { review: "TB-5 authority boundary", fixture, rows, status: fixture.status };
  }
  const publicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_TB5_PUBLIC_KEY_PATH?.trim() ?? null;
  const fixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_TB5_FIXTURE_ROOT?.trim() ?? null;
  const publicKeyPem = publicKeyPath ? await readFile(publicKeyPath, "utf8").catch(() => null) : null;
  const packetIntegrity = await verifyExternalPacket(fixture.packet, { publicKeyPem, candidate, fixturePath: fixtureRoot });
  if (!packetIntegrity.valid) {
    const rows = { "TB-5": row(STATUS.FAIL, `The TB-5 packet is not acceptable: ${packetIntegrity.reason}`) };
    return { review: "TB-5 authority boundary", fixture, packetIntegrity, rows, status: STATUS.FAIL };
  }
  const packet = fixture.packet;
  const manifestCapabilities = values(packet.manifest?.requested_capabilities ?? packet.manifestCapabilities ?? packet.manifest_capabilities);
  const approvalCapabilities = values(packet.approval?.access ?? packet.approvalCapabilities ?? packet.approval_capabilities);
  const hostCapabilities = values(packet.hostContract?.allowed_capabilities ?? packet.hostCapabilities ?? packet.host_capabilities);
  const extraApproval = approvalCapabilities.filter((entry) => !manifestCapabilities.includes(entry));
  const missingApproval = manifestCapabilities.filter((entry) => !approvalCapabilities.includes(entry));
  const outsideHost = approvalCapabilities.filter((entry) => !hostCapabilities.includes(entry));
  const approvalObserved = lifecycleEvents.some((event) => /approval|access|capabilit/i.test(`${event.event} ${JSON.stringify(event.details ?? {})}`))
    || approvalDialogs.some((dialog) => /approv|access|capabilit/i.test(String(dialog)));
  const complete = manifestCapabilities.length > 0 && approvalCapabilities.length > 0 && hostCapabilities.length > 0;
  const pass = complete && approvalObserved && extraApproval.length === 0 && missingApproval.length === 0 && outsideHost.length === 0;
  const rows = {
    "TB-5": pass
      ? row(STATUS.PASS, "The signed manifest, approval access list, and Host allowlist are non-empty, equal, and joined to a raw approval observation.")
      : row(STATUS.FAIL, `Authority diff failed. Manifest/approval/Host completeness: ${complete}; extra: ${extraApproval.join(", ") || "none"}; missing: ${missingApproval.join(", ") || "none"}; outside Host: ${outsideHost.join(", ") || "none"}; approval observed: ${approvalObserved}.`),
  };
  return { review: "TB-5 authority boundary", fixture, packetIntegrity, manifestCapabilities, approvalCapabilities, hostCapabilities, extraApproval, missingApproval, outsideHost, approvalObserved, lifecycleEvents, rows, status: reviewStatus(rows) };
}
