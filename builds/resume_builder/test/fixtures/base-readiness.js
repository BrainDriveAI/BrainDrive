// Frozen readiness oracle from commit 2756b32c6be11aca5e6e9476ac4a7f4e356b703d. Do not update with production fixes.
// Verbatim readiness functions and normalization dependency from resources/inference-program.js.
const DATE_ENDPOINT_PATTERN = String.raw`(?:Present|Current|Now|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+[12][0-9]{3}|[12][0-9]{3})`;

function analyzeResumeProfileReadiness(profileMarkdown) {
  const normalized = normalizeResumeMarkdown(profileMarkdown);
  const missingEssentials = [];
  if (!hasResumeIdentity(normalized)) {
    missingEssentials.push({
      field_id: "contact_identity",
      label: "Contact identity",
      reason: "Profile needs a usable owner name or contact identity before resume creation.",
    });
  }
  if (!hasUsableSection(normalized, /^(?:professional\s+)?(?:experience|work\s+experience|work\s+history|employment)\b/i)) {
    missingEssentials.push({
      field_id: "experience",
      label: "Experience",
      reason: "Profile needs at least one usable experience entry before resume creation.",
    });
  }
  for (const [index, gapText] of extractGapMarkers(normalized).entries()) {
    missingEssentials.push({
      field_id: `gap_marker_${index + 1}`,
      label: `Unresolved gap: ${gapText}`,
      reason: "Profile contains a visible gap marker that must be resolved or explicitly accepted before resume creation.",
    });
  }
  return { missingEssentials };
}


function hasResumeIdentity(profileMarkdown) {
  const heading = profileMarkdown.split(/\r?\n/).find((line) => /^#\s+\S/.test(line.trim()))?.replace(/^#\s+/, "").trim();
  if (heading && !/^(?:resume|resume\s+profile|profile)$/i.test(heading)) return true;
  return hasUsableSection(profileMarkdown, /^(?:contact|contact\s+identity|personal\s+details)\b/i);
}


function hasUsableSection(profileMarkdown, headingPattern) {
  let inSection = false;
  for (const rawLine of profileMarkdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      inSection = headingPattern.test(heading[1]?.trim() ?? "");
      continue;
    }
    if (inSection && isUsableProfileContentLine(line)) return true;
  }
  return false;
}


function isUsableProfileContentLine(line) {
  const text = line.replace(/^[-*+]\s+/, "").trim();
  if (!text) return false;
  return !/^\[gap:\s*[^\]]+\]$/i.test(text);
}


function extractGapMarkers(profileMarkdown) {
  return Array.from(profileMarkdown.matchAll(/\[gap:\s*([^\]]+)\]/gi), (match) => match[1]?.replace(/\s+/g, " ").trim() ?? "unspecified").filter(Boolean);
}


function normalizeResumeMarkdown(markdown) {
  const dateTrailingBulletPattern = new RegExp(String.raw`\b(${DATE_ENDPOINT_PATTERN})\s+([-*+]\s+)(?!(?:${DATE_ENDPOINT_PATTERN})\b)`, "gi");
  return String(markdown ?? "")
    .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
    .replace(/(^|\n)(#{2,6}\s+[A-Za-z][A-Za-z0-9 &/().,:]{0,80})\s+([-*+]\s+)/g, "$1$2\n$3")
    .replace(dateTrailingBulletPattern, "$1\n$2")
    .replace(/([.!?])\s+((?:[-*+]|\d+[.)])\s+)/g, "$1\n$2")
    .replace(/\n[ \t]+((?:[-*+]|\d+[.)])\s+)/g, "\n$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export { analyzeResumeProfileReadiness, normalizeResumeMarkdown };
