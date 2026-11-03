import { access, constants, readFile } from "node:fs/promises";
import { verifyExternalPacket } from "./packet-tools.mjs";
import { STATUS, reviewStatus } from "./verification-contract.mjs";

const MAX_ELAPSED_MS = 3 * 60 * 1000;
const REQUIRED_EVENTS = ["forum_post_opened", "setup_opened", "apps_opened", "install_clicked", "install_committed", "open_visible"];

function row(status, basis) {
  return { status, basis };
}

async function readPacket() {
  const packetPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_OBSERVATION_PATH?.trim() ?? null;
  if (!packetPath) return { status: STATUS.BLOCKED, path: null, packet: null, basis: "The signed Katie forum-post observation packet is not supplied." };
  try {
    await access(packetPath, constants.R_OK);
    return { status: STATUS.PASS, path: packetPath, packet: JSON.parse(await readFile(packetPath, "utf8")), basis: "The Katie packet is readable." };
  } catch (error) {
    return { status: STATUS.FAIL, path: packetPath, packet: null, basis: `The configured Katie packet is not valid readable JSON: ${error.message}` };
  }
}

function eventsFrom(packet) {
  const events = packet?.rawEvidence?.events ?? packet?.raw_events ?? packet?.events;
  return Array.isArray(events) ? events : [];
}

function eventType(event) {
  return String(event?.type ?? event?.event ?? "").toLowerCase();
}

function eventTime(event) {
  const parsed = Date.parse(event?.timestamp ?? event?.at ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

/** Review Katie only from a signed, candidate-bound raw forum-post journey. */
export async function reviewKatieJourney({ candidate = null, lifecycleEvents = [], inputActions = [] } = {}) {
  const fixture = await readPacket();
  if (fixture.status !== STATUS.PASS) {
    const rows = { "AC-1.3": row(fixture.status, fixture.basis) };
    return { review: "E-1 P-1 Katie journey", fixture, rows, status: fixture.status };
  }

  const packet = fixture.packet;
  const publicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_PUBLIC_KEY_PATH?.trim() ?? null;
  const fixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_FIXTURE_ROOT?.trim() ?? null;
  const publicKeyPem = publicKeyPath ? await readFile(publicKeyPath, "utf8").catch(() => null) : null;
  const packetIntegrity = await verifyExternalPacket(packet, { publicKeyPem, candidate, fixturePath: fixtureRoot });
  if (!packetIntegrity.valid) {
    const rows = { "AC-1.3": row(STATUS.FAIL, `The Katie packet is not acceptable: ${packetIntegrity.reason}`) };
    return { review: "E-1 P-1 Katie journey", fixture, packetIntegrity, rows, status: STATUS.FAIL };
  }

  const events = eventsFrom(packet);
  const types = events.map(eventType);
  const missingEvents = REQUIRED_EVENTS.filter((required) => !types.includes(required));
  const timestamps = events.map(eventTime);
  const malformedTimestamps = timestamps.some((timestamp) => timestamp === null);
  const start = events.find((event) => eventType(event) === "forum_post_opened");
  const stop = events.find((event) => eventType(event) === "open_visible");
  const elapsedMs = start && stop ? eventTime(stop) - eventTime(start) : null;
  const ordered = events.every((event, index) => index === 0 || (eventTime(events[index - 1]) ?? Infinity) <= (eventTime(event) ?? -Infinity));
  const installClicks = events.filter((event) => eventType(event) === "install_clicked").length;
  const installCommits = events.filter((event) => eventType(event) === "install_committed").length;
  const retries = events.filter((event) => /retry|recover/.test(eventType(event))).length;
  const forumSource = String(start?.source ?? start?.sourceType ?? "").toLowerCase();
  const sourcePass = /forum[_ -]?post|forum/.test(forumSource) && Boolean(start?.url || start?.reference || start?.contentDigest);
  const forumScreenshotPass = Boolean(start?.screenshot) && await access(start.screenshot, constants.R_OK).then(() => true, () => false);
  const openScreenshotPass = Boolean(stop?.screenshot) && await access(stop.screenshot, constants.R_OK).then(() => true, () => false);
  const nativeActionCountsMatch = inputActions.length === 0 || inputActions.filter((action) => /install resume builder/i.test(String(action.control ?? ""))).length === installClicks;
  const nativeLifecycleMatches = lifecycleEvents.length === 0 || lifecycleEvents.filter((event) => event.details?.lifecycle_action === "install" && event.details?.outcome === "committed").length === installCommits;
  const pass = missingEvents.length === 0 && !malformedTimestamps && ordered && elapsedMs >= 0 && elapsedMs <= MAX_ELAPSED_MS
    && installClicks === 1 && installCommits === 1 && retries === 0 && sourcePass && forumScreenshotPass && openScreenshotPass
    && nativeActionCountsMatch && nativeLifecycleMatches;
  const basis = pass
    ? `The signed raw Katie journey starts at the forum post, reaches Open in ${elapsedMs} ms, and recomputes one Install, one committed lifecycle event, and zero retries.`
    : `The raw Katie journey failed closed. Missing events: ${missingEvents.join(", ") || "none"}; ordered timestamps: ${ordered}; elapsed: ${elapsedMs ?? "missing"}; install clicks/commits/retries: ${installClicks}/${installCommits}/${retries}; forum source/screenshots: ${sourcePass}/${forumScreenshotPass}/${openScreenshotPass}; native joins: ${nativeActionCountsMatch && nativeLifecycleMatches}.`;
  const rows = { "AC-1.3": row(pass ? STATUS.PASS : STATUS.FAIL, basis) };
  return { review: "E-1 P-1 Katie journey", fixture, packetIntegrity, eventCount: events.length, missingEvents, elapsedMs, installClicks, installCommits, retries, rows, status: reviewStatus(rows) };
}
