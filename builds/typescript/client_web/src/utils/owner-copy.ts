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
  [/\bupdated everything behind the scenes\b/gi, "updated the relevant saved materials"],
  [/\bbehind the scenes\b/gi, "in the saved materials"],
  [/\bdebt-crushing fuel\b/gi, "extra debt-payment capacity"],
  [/\bweaponize that surplus\b/gi, "use that surplus"],
  [/\bmonster in the dark\b/gi, "unclear debt picture"],
  [/\bominous indicator\b/gi, "Interest cost to monitor"],
  [/\bthe stress is officially a math problem now\b/gi, "the next step is to verify the numbers and choose the payment plan"],
  [/\bover half of your minimum payments disappear into thin air\b/gi, "more than half of your minimum payments went to interest this month"],
  [/\bsiphon of interest charges\b/gi, "interest charges"],
  [/\bdirectly to destroy the ([^.]+?)\b/gi, "directly toward paying down the $1"],
  [/\bget the banks' hands out of your pockets\b/gi, "reduce the interest you pay to lenders"],
  [/\bestimated monthly overhead is\s*(\$[\d,.]+)/gi, "estimated monthly take-home income is $1"],
  [/\bmonthly overhead of\s*(\$[\d,.]+)/gi, "monthly take-home income of $1"],
  [/\bAfter your\s*(\$[\d,.]+)\s+rent portion,\s+you have\s*(\$[\d,.]+)\s+left over\b/gi, "After your $1 rent portion, about $2 remains before other fixed bills and missing spending evidence"],
  [/\bzero hesitation or dread\b/gi, "less hesitation and stress"],
  [/\bpermanently secure\b/gi, "easier to protect"],
  [/\bevery single month\b/gi, "month by month as the numbers are verified"],
  [/\bwe should pause those contributions immediately once we confirm the numbers\b/gi, "one option to review after we confirm the numbers is temporarily redirecting new contributions"],
  [/\bpause those contributions immediately\b/gi, "review temporarily redirecting new contributions"],
  [/\bStopping your contributions temporarily plugs the hole\b/gi, "Temporarily redirecting new contributions is a decision to review once APRs and minimums are confirmed"],
  [/\bpausing those new contributions temporarily to redirect that money toward\b/gi, "reviewing whether any new contributions should temporarily be redirected toward"],
  [/\bpausing new contributions temporarily to redirect that money toward\b/gi, "reviewing whether any new contributions should temporarily be redirected toward"],
  [/\bShould you pause or keep making current contributions\?/gi, "Whether any current contribution level should change is a later owner decision after exact cash-flow facts are known."],
  [/\bIf you pause contributions temporarily:\s*You free up immediate monthly cash flow\./gi, "If you review contribution changes later, treat them as a cash-flow decision after exact bills, card APRs, minimum payments, tax considerations, and any employer-match context are known."],
  [/\bThis lets you build your \$1,000 emergency shield much faster and burn down those high-interest credit cards sooner\./gi, "Do not use Roth assets for short-term debt; keep the payoff details in Your Plan for review before acting."],
  [/\bOnce the debt is gone and the shield is in place, you can resume contributions aggressively\./gi, "Any future contribution change should be revisited after the debt and starter shield are stable."],
  [/\bContributions\s*\([^)]*withdraw[^)]*\)\s*stay invested\.\s*Earnings stay invested\./gi, "This plan does not use the Roth IRA as a funding source. Any contribution or withdrawal change is a separate owner decision with tax and retirement tradeoffs."],
  [/\bContributions stay invested\.\s*Earnings stay invested\./gi, "This plan does not use the Roth IRA as a funding source. Any contribution or withdrawal change is a separate owner decision with tax and retirement tradeoffs."],
  [/\bthrow that cash at the credit cards\b/gi, "review redirecting that cash toward credit-card payoff after the numbers are confirmed"],
  [/\bthrow cash at (?:the )?credit cards\b/gi, "review redirecting cash toward credit-card payoff after the numbers are confirmed"],
  [/\bRoth IRA Contribution Pacify\/Pause\b/g, "Roth IRA contribution pause/reduce decision"],
  [/\bI also built your Finance goals and Plan \(Finance plan\) in your saved Budget materials\./gi, "I saved your Finance goals and Your Plan."],
  [/\bI have completed, verified, and saved your Finance goals and Your Plan directly into your project files\./gi, "I saved your Finance goals and Your Plan."],
  [/\bI've saved this exact framing and these guardrails directly under the Owner Decisions and Planning Guardrails sections of Your Plan\./gi, "Your Plan now includes these Roth IRA guardrails under Owner Decisions and Planning Guardrails."],
  [/\bfinancial goals and action plans\b/gi, "Your Goals and Your Plan"],
  [/\bThe Budgeting app is explicitly deferred and bypassed\b/gi, "Budgeting is not needed for the next step"],
  [/\bEXPLICITLY DEFERRED\s*\/\s*BYPASSED\b/g, "Conditionally deferred"],
  [/\bpaused indefinitely\b/gi, "deferred for now"],
  [/\bentirely through high-level cash flow design \(Parent planning\)/gi, "by starting with one-card facts and rent protection before deciding whether Budgeting is needed"],
  [/\bNo Force-Budgeting\b/g, "Conditional Budgeting Gate"],
  [/\bThe Burn\b/g, "Debt Paydown"],
  [/\bburn down those high-interest credit cards\b/gi, "pay down those high-interest credit cards"],
  [/\bwipe it out\b/gi, "pay it down"],
  [/\bwiping out debt\b/gi, "paying down debt"],
  [/\bwiping out details of the estimated\b/gi, "paying down the estimated"],
  [/\brun the numbers layout\b/gi, "build the payoff math"],
  [/\bThere is no investment fund on earth that will reliably grow at 20% to 30% a year\b/gi, "High-interest card APRs can outweigh expected investment returns, so this is a tradeoff to review carefully"],
  [/\bhoShopping\b/g, "Shopping"],
  [/\bresuIncrease\b/g, "resume/increase"],
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
    .replace(/(?:^|\n)\s*with (?:these exact terms|your income, rent agreements, and those specific sources of financial stress)\.\s*/gi, "\n")
    .replace(/Constraints,\s*tradeoffs,\s*risks,\s*unknowns\s*[—-]\s*summarized:\s*\|\s*Category\s*\|\s*What it means for you\s*\|[\s\S]*?(?=\s*Critical missing evidence|\s*Next question:|$)/gi, "Key constraints:\n- APRs and minimum payments are still missing.\n- Statement avoidance is part of the plan, not a side issue.\n- Cash flow is unclear until essentials and minimums are known.\n\n")
    .replace(/The critical path gaps \(these change the plan if wrong\):\s*\|\s*Gap\s*\|\s*Why it matters\s*\|[\s\S]*?(?=\s*Key risks called out:|$)/gi, "The critical path gaps are saved in Your Goals. The first three to confirm are credit-card terms, cash on hand, and Evan rent stability.\n\n")
    .replace(/Unknowns \(Missing Evidence\)\s*\|\s*Item\s*\|\s*Status\s*\|[\s\S]*?(?=\s*Your four goals|$)/gi, "Unknowns are saved in Your Goals. The critical missing evidence is credit-card APRs and minimum payments, cash on hand, and monthly must-pays.\n\n")
    .replace(/How the Roth IRA factors \(and doesn't\) into this plan:\s*\|\s*Does factor in\s*\|\s*Does NOT factor in\s*\|[\s\S]*?(?=\s*Bottom line:|$)/gi, "How the Roth IRA fits: it is planning context for contribution decisions. It is not cushion money, debt-payoff cash, or a reason for fund, trade, security, or allocation recommendations.\n\n")
    .replace(/How it factors \(or doesn't\) in this plan:\s*\|\s*Aspect\s*\|\s*Treatment in This Plan\s*\|[\s\S]*?(?=\s*Why this boundary exists:|$)/gi, "How the Roth IRA fits: it is not a funding source for this Finance plan. Contribution changes or withdrawals are separate owner decisions with tax and retirement tradeoffs. No fund or trade recommendations are part of this workflow.\n\n")
    .replace(/Detailed Budget Category Breakdown\s*\|\s*Category\s*\|\s*Budget Limit \/ Spent\s*\|[\s\S]*?(?=\n(?:Part\s+\d+:|Your Next Steps|What do you think|Do you recognize|$))/gi, "Detailed Budget category breakdown is saved in the latest Budget report.\n\n")
    .replace(/\bcashwas\*?\s*(\$)/gi, "cash was $1")
    .replace(/^#{1,6}\s*([^*\n]+?)\*+\s*$/gm, "$1")
    .replace(/\b([A-Za-z][A-Za-z ]{1,60}):\*\*\s*([^*\n|]+?)\*\*/g, "$1: $2")
    .replace(/\bAPR:\*\*\s*([^*\n|]+?)\*\*/gi, "APR: $1")
    .replace(/\bMinimum Payment:\*\*\s*([^*\n|]+?)\*\*/gi, "Minimum payment: $1")
    .replace(/\bMinimum Payment:/g, "Minimum payment:")
    .replace(/([A-Za-z])\*\*\s+(\d)/g, "$1 $2")
    .replace(/\b(for|and)\*\*\s*(\$)/gi, "$1 $2")
    .replace(/\bonly\*\*\s*([^*\n]+?)\*\*/gi, "only $1")
    .replace(/\s+—\*\*\s*/g, " - ")
    .replace(/([.!?:])\*\*(?=\s|$)/g, "$1")
    .replace(/\*\*\s*(?=\()/g, " ")
    .replace(/(?<![A-Za-z0-9).,;:!?])\*\*\s*$/gm, "")
    .replace(/\)\*{2,}(?=\s*(?:\n|$))/g, ")")
    .replace(/\btasks:\*/gi, "tasks:")
    .replace(/\bor\*+\s+/gi, "or ")
    .replace(/\*\*([^*\n]+?)\s+\*\*/g, "**$1**")
    .replace(/\*\*([^*\n]{2,80})\*\*(?=\S)/g, "**$1** ")
    .replace(/\*\*([^*\n]+?)\s+\*(?=\s{2,}|\n)/g, "**$1**\n")
    .replace(/^\s+\*\s{2,}/gm, "- ")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "**$1:** ")
    .replace(/\*\*([^*\n:]{2,80}):\s+\*\*/g, "**$1:** ")
    .replace(/\*\*([^*\n:]{2,80}):\s+\*\*([^\n])/g, "**$1:** $2")
    .replace(/\*\*(\$[\d,.]+[^*\n]{0,80}?)\s+\*([^*\n]{1,80}?)\.\s+\*\*/g, "**$1 $2.** ")
    .replace(/\*\*(\d+)\.\s*\n([^*\n]+?)\s+\*\*(?=\d+\.)/g, "$1. $2\n")
    .replace(/^(\s*)([-*])\s*\*{1,2}([^*\n:]{2,80}:)\*{1,2}\s*/gm, "$1$2 **$3** ")
    .replace(/^(\d+)\.(?=\S)/gm, "$1. ")
    .replace(/^(\s*)(\d+)\.\s*\*{1,2}([^*\n]+?)\*{1,2}\s*$/gm, "$1$2. $3")
    .replace(/^(\s*)([-*])\s*\*{1,2}([^*\n]+?)\*{1,2}\s*$/gm, "$1$2 $3")
    .replace(/([^\n])\n(?=\s*\d+\.\s)/g, "$1\n\n")
    .replace(/([^\n])\n(?=\s*[-*]\s)/g, "$1\n\n")
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
    .replace(/([A-Za-z0-9).,;:!?])\*\*(?=\s|$)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
