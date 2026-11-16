// PROTOTYPE ONLY: stands in for Your Memory's history so the Experts prototype can show last-saved
// times (Page changes PC-7.1) and earlier versions of a file (PC-7.2) without a server change.
// Times and the first earlier versions are samples. Versions saved in this browser session are real:
// every save and every "Make this the current version" keeps the text it replaced, so nothing is lost
// while the page is open. Nothing here is sent anywhere.

export type FileVersion = { id: string; savedAt: Date; text: string };

const versions = new Map<string, FileVersion[]>();
let counter = 0;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

/** A sample last-saved time for a file, stable for the same path: some time in the last week. */
export function sampleLastSaved(path: string, now = new Date()): Date {
  return new Date(now.getTime() - ((hash(path) % (7 * 24 * 60)) + 5) * 60_000);
}

export function formatSavedTime(date: Date): string {
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function sampleEarlier(path: string, current: string): FileVersion[] {
  const lines = current.split("\n");
  const base = sampleLastSaved(path).getTime();
  const cut = (share: number) => lines.slice(0, Math.max(1, Math.floor(lines.length * share))).join("\n");
  const drafts = [cut(0.6), cut(0.3)].filter((text, index, all) => text.trim() !== current.trim() && all.indexOf(text) === index);
  return drafts.map((text, index) => ({ id: `sample-${index}`, savedAt: new Date(base - (index + 1) * 2 * 24 * 60 * 60_000), text }));
}

/** Earlier versions of a file, newest first. Seeded with samples the first time a file is opened. */
export function earlierVersions(path: string, current: string): FileVersion[] {
  if (!versions.has(path)) versions.set(path, sampleEarlier(path, current));
  return versions.get(path)!;
}

/** Called after a save: the text that was replaced becomes the newest earlier version. */
export function keepReplacedVersion(path: string, replaced: string, savedAt = new Date()) {
  const list = versions.get(path) ?? [];
  versions.set(path, [{ id: `kept-${++counter}`, savedAt, text: replaced }, ...list]);
}

export function resetFileHistoryMock() { versions.clear(); counter = 0; }
