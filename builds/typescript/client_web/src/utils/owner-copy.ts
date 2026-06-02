import { replaceOwnerVisibleMemoryPaths } from "./owner-labels";

const FINANCE_CONFIDENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bperfect data\b/gi, "the available data"],
  [/\bperfectly clear\b/gi, "clear enough to review"],
  [/\bmatches to the penny\b/gi, "matches the visible statement rows"],
  [/\breconciles perfectly\b/gi, "reconciles to the current statement rows, with review items still called out"],
  [/\bperfectly reflect(?:s|ed)?\b/gi, "reflect"],
  [/\bfully accounted for\b/gi, "accounted for in this draft"],
  [/\bcompletely reconciled\b/gi, "reconciled based on the visible rows"],
  [/\bfully completed actuals ledger\b/gi, "draft actuals ledger"],
  [/\bpermanently mapped\b/gi, "categorized in this budget draft"],
  [/\blocked in\b/gi, "saved as a draft"],
  [/\bupdated everything behind the scenes\b/gi, "updated the relevant saved Budget materials"],
  [/\bbehind the scenes\b/gi, "in your saved Budget materials"],
  [/\bdebt-crushing fuel\b/gi, "extra debt-payment capacity"],
  [/\bweaponize that surplus\b/gi, "use that surplus"],
  [/\bmonster in the dark\b/gi, "unclear debt picture"],
  [/\bominous indicator\b/gi, "Interest cost to monitor"],
  [/\bthe stress is officially a math problem now\b/gi, "the next step is to verify the numbers and choose the payment plan"],
  [/\bover half of your minimum payments disappear into thin air\b/gi, "more than half of your minimum payments went to interest this month"],
  [/\bsiphon of interest charges\b/gi, "interest charges"],
  [/\bdirectly to destroy the ([^.]+?)\b/gi, "directly toward paying down the $1"],
  [/\bget the banks' hands out of your pockets\b/gi, "reduce the interest you pay to lenders"],
  [/\bhoShopping\b/g, "Shopping"],
  [/\bFinance goals\s*\(spec\.md\)/gi, "Finance goals"],
  [/\bFinance plan\s*\(plan\.md\)/gi, "Finance plan"],
  [/\bspec\.md\b/gi, "Finance goals"],
  [/\bplan\.md\b/gi, "Finance plan"],
  [/\bme\/todo\.md\b/gi, "action list"],
  [/\btodo\.md\b/gi, "action list"],
  [/\bTodo list\b/g, "action list"],
  [/\btodo list\b/g, "action list"],
];

export function polishOwnerVisibleAssistantCopy(text: string): string {
  let polished = replaceOwnerVisibleMemoryPaths(text);
  for (const [pattern, replacement] of FINANCE_CONFIDENCE_REPLACEMENTS) {
    polished = polished.replace(pattern, replacement);
  }
  return normalizeMalformedMarkdownSpacing(polished);
}

function normalizeMalformedMarkdownSpacing(text: string): string {
  return text
    .replace(/Detailed Budget Category Breakdown\s*\|\s*Category\s*\|\s*Budget Limit \/ Spent\s*\|[\s\S]*?(?=\n(?:Part\s+\d+:|Your Next Steps|What do you think|Do you recognize|$))/gi, "Detailed Budget category breakdown is saved in the latest Budget report.\n\n")
    .replace(/\bcashwas\*?\s*(\$)/gi, "cash was $1")
    .replace(/\*\*([^*\n]+?)\s+\*\*/g, "**$1**")
    .replace(/\*\*([^*\n]{2,80})\*\*(?=\S)/g, "**$1** ")
    .replace(/\*\*([^*\n]+?)\s+\*(?=\s{2,}|\n)/g, "**$1**\n")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "**$1:** ")
    .replace(/\*\*([^*\n:]{2,80}):\s+\*\*/g, "**$1:** ")
    .replace(/\*\*([^*\n:]{2,80}):\s+\*\*([^\n])/g, "**$1:** $2")
    .replace(/\*\*(\$[\d,.]+[^*\n]{0,80}?)\s+\*([^*\n]{1,80}?)\.\s+\*\*/g, "**$1 $2.** ")
    .replace(/\*\*(\d+)\.\s*\n([^*\n]+?)\s+\*\*(?=\d+\.)/g, "$1. $2\n")
    .replace(/^(\d+)\.(?=\S)/gm, "$1. ")
    .replace(/\*+([^*\n]+?\(\$[\d,.]+\))\*+\*+([^*\n]+?\(\$[\d,.]+\))\*+/g, "- $1\n- $2")
    .replace(/([a-z])(\*\*\$)/g, "$1 $2")
    .replace(/(\d)([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*:\*+)/g, "$1\n$2")
    .replace(/(\$[\d,.]+)(balance\b)/gi, "$1 balance")
    .replace(/(rate:)([\d.]+%)/gi, "$1 $2")
    .replace(/(payment:)(\$[\d,.]+)/gi, "$1 $2")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/(\$[\d,.]+)\s+\*\*([.!?])/g, "$1$2")
    .replace(/(\*\*+)([A-Z][^*\n]{1,80}\(\$[\d,.]+\))/g, "\n$1$2")
    .replace(/([A-Za-z])for(\*\*\$[\d,.]+\*\*)/g, "$1 for $2")
    .replace(/\*{4,}/g, "**")
    .replace(/([^\s])\*\*([^\s*])/g, "$1 **$2")
    .replace(/([^\s*])\*\*([^\s])/g, "$1** $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
