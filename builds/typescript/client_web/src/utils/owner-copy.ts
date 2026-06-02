import { replaceOwnerVisibleMemoryPaths } from "./owner-labels";

const FINANCE_CONFIDENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bperfect data\b/gi, "the available data"],
  [/\bperfectly reflect(?:s|ed)?\b/gi, "reflect"],
  [/\bfully accounted for\b/gi, "accounted for in this draft"],
  [/\bcompletely reconciled\b/gi, "reconciled based on the visible rows"],
  [/\bfully completed actuals ledger\b/gi, "draft actuals ledger"],
  [/\bpermanently mapped\b/gi, "categorized in this budget draft"],
  [/\blocked in\b/gi, "saved as a draft"],
  [/\bupdated everything behind the scenes\b/gi, "updated the relevant saved Budget materials"],
  [/\bbehind the scenes\b/gi, "in your saved Budget materials"],
  [/\bdebt-crushing fuel\b/gi, "extra debt-payment capacity"],
  [/\bthe stress is officially a math problem now\b/gi, "the next step is to verify the numbers and choose the payment plan"],
  [/\bover half of your minimum payments disappear into thin air\b/gi, "more than half of your minimum payments went to interest this month"],
  [/\bsiphon of interest charges\b/gi, "interest charges"],
  [/\bdirectly to destroy the ([^.]+?)\b/gi, "directly toward paying down the $1"],
  [/\bget the banks' hands out of your pockets\b/gi, "reduce the interest you pay to lenders"],
];

export function polishOwnerVisibleAssistantCopy(text: string): string {
  let polished = replaceOwnerVisibleMemoryPaths(text);
  for (const [pattern, replacement] of FINANCE_CONFIDENCE_REPLACEMENTS) {
    polished = polished.replace(pattern, replacement);
  }
  return polished;
}
