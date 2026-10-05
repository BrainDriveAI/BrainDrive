export type CleanTextRecovery = {
  headings: string[];
  emails: string[];
  urls: string[];
  role_associations: Array<{ title: string; employer: string; dates: string }>;
  readable_unicode: boolean;
  line_count: number;
};

const STANDARD_HEADINGS = new Set(["Summary", "Skills", "Experience", "Work Experience", "Education", "Certifications", "Projects", "Volunteer Experience", "Awards", "Publications", "Leadership", "Volunteer", "Links"]);
const DATE_RANGE = /(?:\b(?:19|20)\d{2}\b|\bPresent\b).*(?:\b(?:19|20)\d{2}\b|\bPresent\b)/i;

/** Independent field recovery: this module deliberately imports no renderer code. */
export function extractCleanTextFields(text: string): CleanTextRecovery {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headings = lines.filter((line) => STANDARD_HEADINGS.has(line));
  const emails = [...text.matchAll(/\b[^\s@|]+@[^\s@|]+\.[^\s@|]+\b/g)].map((match) => match[0]);
  const urls = [...text.matchAll(/https?:\/\/[^\s|]+/g)].map((match) => match[0]).filter((value) => {
    try { new URL(value); return true; } catch { return false; }
  });
  const roleAssociations = lines.flatMap((line) => {
    if (!DATE_RANGE.test(line)) return [];
    const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return [];
    return [{ title: parts[0]!, employer: parts[1]!, dates: parts.slice(2).join(" | ") }];
  });
  return {
    headings,
    emails,
    urls,
    role_associations: roleAssociations,
    readable_unicode: !/[\uFFFD\u0000]/u.test(text),
    line_count: lines.length,
  };
}
