import { render, screen } from "@testing-library/react";

import type { Message } from "@/types/ui";

import MessageList from "./MessageList";

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  scrollIntoViewMock.mockReset();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

describe("MessageList scroll behavior", () => {
  it("does not jump to the bottom when an assistant response starts", () => {
    const userMessage: Message = { id: "u-1", role: "user", content: "Build me a fitness plan" };
    const assistantMessage: Message = { id: "a-1", role: "assistant", content: "Here is a plan..." };

    const { rerender } = render(<MessageList messages={[userMessage]} />);
    scrollIntoViewMock.mockClear();

    rerender(<MessageList messages={[userMessage, assistantMessage]} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("scrolls down when the user submits a new message", () => {
    const userMessage: Message = { id: "u-1", role: "user", content: "Build me a fitness plan" };

    const { rerender } = render(<MessageList messages={[]} />);
    scrollIntoViewMock.mockClear();

    rerender(<MessageList messages={[userMessage]} />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it("renders owner-facing labels instead of internal Memory paths in assistant messages", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "Updated `documents/finance/budget/budget.md`, documents/finance/budget/reports/latest.md, and me/todo.md.",
          },
        ]}
      />
    );

    expect(screen.getByText(/saved Budget/)).toBeInTheDocument();
    expect(screen.getByText(/latest Budget report/)).toBeInTheDocument();
    expect(screen.getByText(/action list/)).toBeInTheDocument();
    expect(screen.queryByText(/documents\/finance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/me\/todo/)).not.toBeInTheDocument();
  });

  it("marks chat messages with stable owner-visible roles for UX evidence", () => {
    render(
      <MessageList
        messages={[
          { id: "u-1", role: "user", content: "I need help with rent." },
          { id: "a-1", role: "assistant", content: "I can help you build a plan." },
        ]}
      />
    );

    const userArticle = document.querySelector('article[data-message-role="user"]');
    const assistantArticle = document.querySelector('article[data-message-role="assistant"]');
    expect(userArticle?.textContent).toContain("I need help with rent.");
    expect(assistantArticle?.textContent).toContain("I can help you build a plan.");
  });

  it("compacts acknowledged multi-file upload receipts in the chat history", () => {
    render(
      <MessageList
        messages={[
          {
            id: "u-1",
            role: "user",
            content: [
              "Uploaded 7 statements:",
              "- Cedar Atlantic checking statement (April 2026 · Budget statements)",
              "- Northbridge Rewards Visa statement (April 2026 · Budget statements)",
              "- Summit Trail Everyday Mastercard statement (April 2026 · Budget statements)",
              "- Harborline Roth IRA statement (April 2026 · Budget statements)",
            ].join("\n"),
          },
          {
            id: "a-1",
            role: "assistant",
            content: "I received the statements and can build the saved Budget next.",
          },
        ]}
      />
    );

    expect(screen.getByText("7 statements uploaded. Details collapsed after BrainDrive acknowledged them.")).toBeVisible();
    expect(screen.getByText(/I received the statements/)).toBeVisible();
    expect(screen.getByText(/Cedar Atlantic checking statement/)).not.toBeVisible();
    expect(screen.getByText(/Northbridge Rewards Visa statement/)).not.toBeVisible();
  });

  it("hides internal finance artifact filenames in owner-visible assistant messages", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "Updated your Finance goals (spec.md), created your customized Finance plan (plan.md), and checked off the Todo list task in me/todo.md.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Finance goals");
    expect(rendered).toContain("Finance plan");
    expect(rendered).toContain("action list");
    expect(rendered).not.toMatch(/spec\.md|plan\.md|todo\.md|Todo list|me\/todo/i);
  });

  it("softens unsupported finance confidence language in owner-visible assistant messages", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "This is perfect data with a fully completed actuals ledger. Everything is completely reconciled and permanently mapped behind the scenes. Send extra cash directly to destroy the Northbridge Visa and get the banks' hands out of your pockets. Roth IRA Contribution Pacify/Pause means we can throw that cash at the credit cards.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("available data");
    expect(rendered).toContain("draft actuals ledger");
    expect(rendered).toContain("reconciled based on the visible rows");
    expect(rendered).toContain("categorized in this budget draft");
    expect(rendered).toContain("directly toward paying down the Northbridge Visa");
    expect(rendered).toContain("reduce the interest you pay to lenders");
    expect(rendered).toContain("Roth IRA contribution pause/reduce decision");
    expect(rendered).toContain("review redirecting that cash toward credit-card payoff after the numbers are confirmed");
    expect(rendered).not.toMatch(/perfect data|fully completed actuals ledger|completely reconciled|permanently mapped|behind the scenes|destroy the Northbridge Visa|banks' hands out of your pockets|throw that cash|Pacify\/Pause/i);
  });

  it("removes Finance fragment starts and awkward retirement/debt phrasing", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "with these exact terms.\nI also built your Finance goals and Plan (Finance plan) in your saved Budget materials. We will look at a tradeoff: pausing those new contributions temporarily to redirect that money toward wiping out details of the estimated $8,000 credit card debt, then run the numbers layout.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("I saved your Finance goals and Your Plan.");
    expect(rendered).toContain("reviewing whether any new contributions should temporarily be redirected toward paying down the estimated $8,000 credit card debt");
    expect(rendered).toContain("build the payoff math");
    expect(rendered).not.toMatch(/with these exact terms|saved Budget materials|wiping out details|run the numbers layout|pausing those new contributions temporarily/i);
  });

  it("calibrates Finance saved-state, Budgeting deferral, and Roth contribution copy", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "I have completed, verified, and saved your Finance goals and Your Plan directly into your project files. The Budgeting app is explicitly deferred and bypassed, and we can achieve this entirely through high-level cash flow design (Parent planning). If you pause contributions temporarily: You free up immediate monthly cash flow. This lets you build your $1,000 emergency shield much faster and burn down those high-interest credit cards sooner. Once the debt is gone and the shield is in place, you can resume contributions aggressively. I've saved this exact framing and these guardrails directly under the Owner Decisions and Planning Guardrails sections of Your Plan.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("I saved your Finance goals and Your Plan.");
    expect(rendered).toContain("Budgeting is not needed for the next step");
    expect(rendered).toContain("by starting with one-card facts and rent protection before deciding whether Budgeting is needed");
    expect(rendered).toContain("treat them as a cash-flow decision after exact bills, card APRs, minimum payments, tax considerations, and any employer-match context are known");
    expect(rendered).toContain("Your Plan now includes these Roth IRA guardrails");
    expect(rendered).not.toMatch(/completed, verified, and saved|explicitly deferred and bypassed|entirely through high-level cash flow design|burn down|resume contributions aggressively|saved this exact framing/i);
  });

  it("collapses dense Finance post-plan replies to one next action", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "I saved your Finance goals and updated your Finance plan to Active. Regarding your request, I made a key strategic decision: Budgeting is deferred. Since your immediate focus is identifying your solid cash-flow baseline and organizing an $8,000 emergency debt paydown, tedious category tracking will only add unnecessary noise right now. Budgeting is not needed for the next step and will be revisited only if spending visibility or category targets become necessary later on. I structure our plan directly around this focus: Key Decision: Budgeting is deferred to keep stress low. We’ll design your plan using high-level cash flow instead of strict spreadsheet logs. Planning Guardrail: The Roth IRA is not a funding source for this Finance plan. The First Action: Log into your credit card accounts and gather the balances, APRs, and minimum payments. Our roadmap and first steps are saved under Your Plan. When you are ready to tackle the numbers, you can easily attach statement files or app screenshots directly in this chat using the upload button. From there, we will outline your exact path forward together.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Done. Your Goals and Plan are saved.");
    expect(rendered).toContain("Budgeting is not needed for this phase.");
    expect(rendered).toContain("capture each card's balance, APR, minimum payment, and due date");
    expect(rendered).not.toMatch(/Regarding your request|tedious category tracking|Planning Guardrail|roadmap and first steps|outline your exact path/i);
  });

  it("cleans known concatenated budget category typos", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: "Category note: hoShopping is higher than expected this month.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Shopping is higher than expected");
    expect(rendered).not.toContain("hoShopping");
  });

  it("polishes malformed Budget markdown and loaded finance phrases", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "Your take-home cashwas*$3,508.84**.",
              "1.Northbridge Rewards Visa:****$4,378.33balance | Interest rate:22.49% APR| Minimum payment:$139.00",
              "***MJP Services ($184.00)*****Blue Door Payment ($67.50)**",
              "Here is the plan to weaponize that surplus. The monster in the dark is solved. Ominous indicator: everything reconciles perfectly.",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("cash");
    expect(rendered).toContain("$3,508.84");
    expect(rendered).toContain("$4,378.33 balance");
    expect(rendered).toContain("Interest rate: 22.49% APR");
    expect(rendered).toContain("Minimum payment: $139.00");
    expect(rendered).toContain("MJP Services ($184.00)");
    expect(rendered).toContain("Blue Door Payment ($67.50)");
    expect(rendered).toContain("use that surplus");
    expect(rendered).toContain("unclear debt picture");
    expect(rendered).toContain("Interest cost to monitor");
    expect(rendered).toContain("reconciles to the current statement rows");
    expect(rendered).not.toMatch(/cashwas|\*{4,}|weaponize|monster in the dark|Ominous indicator|reconciles perfectly/i);
  });

  it("keeps Finance planning lists readable and fixes income terminology", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "### Why We Are Skipping Budgeting For Now",
              "Instead, we are choosing a **cash-flow and debt-priority plan**. Your estimated monthly overhead is $3,800. After your $900 rent portion, you have $2,900 left over. Rather than dissecting every dollar, our focus is structural:",
              "1.  **Protecting your rent.**",
              "2.  **Structuring a quick cash buffer** (so you don't need credit cards again).",
              "3.  **Knocking out the credit cards** using focused math.",
              "",
              "*   **Finance goals:** Captures the goals.",
              "*   **Finance plan:** Outlines the plan.",
              "",
              "**Note on anxiety:** When you go to log into these accounts, **do not look at your transactions.**",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("estimated monthly take-home income is $3,800");
    expect(rendered).toContain("about $2,900 remains before other fixed bills and missing spending evidence");
    expect(rendered).toContain("Protecting your rent.");
    expect(rendered).toContain("Structuring a quick cash buffer");
    expect(rendered).toContain("Finance goals:");
    expect(rendered).toContain("Finance plan:");
    expect(rendered).not.toMatch(/monthly overhead|Protecting your rent\. 2\.|buffer\.\* Finance plan|accounts,do not/);
  });

  it("softens absolute destination language in owner-visible Finance replies", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "The destination is zero hesitation or dread because rent is permanently secure and balances shrink every single month.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("less hesitation and stress");
    expect(rendered).toContain("easier to protect");
    expect(rendered).toContain("month by month as the numbers are verified");
    expect(rendered).not.toMatch(/zero hesitation|permanently secure|every single month/i);
  });

  it("normalizes broken finance emphasis around labels and interest amounts", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "**Your Debt Landscape: **Northbridge Rewards Visa has a balance.",
              "You were charged **$80.19 in interest *in April. **Summit Trail also charged interest.",
              "I generated your **latest Budget report **for review.",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Your Debt Landscape:");
    expect(rendered).toContain("$80.19 in interest in April.");
    expect(rendered).toContain("latest Budget report");
    expect(rendered).not.toContain("**");
    expect(rendered).not.toContain("*in April");
  });

  it("keeps dense Budget tables out of owner-visible chat when markdown collapses", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "**Draft Actuals Baseline **",
              "Detailed Budget Category Breakdown | Category | Budget Limit / Spent | Description/Source |  | :--- | :---: | :--- |  | Fixed Obligations | $1,059.73 | Rent and bills |  | Variable Living Spend | $1,291.13 | Groceries and transit | ---",
              "Part 2: Needs-Review List",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Draft Actuals Baseline");
    expect(rendered).toContain("Detailed Budget category breakdown is saved in the latest Budget report.");
    expect(rendered).toContain("Part 2: Needs-Review List");
    expect(rendered).not.toMatch(/Budget Limit \/ Spent|:---|Fixed Obligations \|/);
    expect(rendered).not.toContain("**");
  });

  it("keeps malformed parent Finance planning tables out of owner-visible chat", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "The critical path gaps (these change the plan if wrong): | Gap | Why it matters | | ----- | ---------------- | | Credit card details (count, balances, APRs, minimums, due dates) | Determines payoff order | Key risks called out: APR uncertainty.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("The critical path gaps are saved in Your Goals.");
    expect(rendered).toContain("Key risks called out");
    expect(rendered).not.toMatch(/\|\s*Gap\s*\||-----|Determines payoff order \|/);
  });

  it("keeps latest flattened missing-evidence tables out of owner-visible chat", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "Unknowns (Missing Evidence) | Item | Status | | ------ | -------- | | Credit card APR(s) & minimum payment(s) | [MISSING] | | Cash on hand | [MISSING] | Your four goals, confirmed?",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Unknowns are saved in Your Goals.");
    expect(rendered).toContain("credit-card APRs and minimum payments");
    expect(rendered).toContain("Your four goals");
    expect(rendered).not.toMatch(/\|\s*Item\s*\||------|\[MISSING\] \|/);
  });

  it("turns malformed Roth IRA chat tables into compact boundary copy", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "How the Roth IRA factors (and doesn't) into this plan: | Does factor in | Does NOT factor in | | ---------------- | --------------------- | | Context for Owner Decision #1 | Cushion source | Long-term context — once debt is gone, Revisit retirement contributions (resuIncrease). | Bottom line: The Roth is a future-you asset.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("For this plan, treat the Roth IRA as outside the short-term cash-flow work");
    expect(rendered).toContain("It is not a funding source for rent, the emergency cushion, or credit-card payoff");
    expect(rendered).toContain("No Roth IRA contribution, withdrawal, balance, or investment action is part of this plan");
    expect(rendered).toContain("Bottom line");
    expect(rendered).not.toMatch(/\|\s*Does factor in\s*\||resuIncrease|----------------|cushion source/i);
  });

  it("turns latest Roth IRA Aspect tables into compact boundary copy", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "How it factors (or doesn't) in this plan: | Aspect | Treatment in This Plan | | -------- | ------------------------ | | Funding source for debt payoff or buffer | Not used. | | Withdrawal of earnings | Not part of this plan. | Why this boundary exists: Your goals are solvable from cash flow.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("For this plan, treat the Roth IRA as outside the short-term cash-flow work");
    expect(rendered).toContain("It is not a funding source for rent, the emergency cushion, or credit-card payoff");
    expect(rendered).toContain("No Roth IRA contribution, withdrawal, balance, or investment action is part of this plan");
    expect(rendered).toContain("Why this boundary exists");
    expect(rendered).not.toMatch(/\|\s*Aspect\s*\||--------|Withdrawal of earnings \||withdrawal of earnings/i);
  });

  it("normalizes upload receipts and APR labels that leaked raw markdown markers", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "Uploaded 7 statements:",
              "- Cedar Atlantic checking statement (April 2026 · Budget statements)**",
              "- Summit Trail Everyday Mastercard statement (April 2026 · Budget statements)**",
              "APR:** 20.74%** | Minimum Payment:** $117.00**",
              "### Core Numbers*",
              "tasks:* review payment timing",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Cedar Atlantic checking statement (April 2026 · Budget statements)");
    expect(rendered).toContain("Summit Trail Everyday Mastercard statement (April 2026 · Budget statements)");
    expect(rendered).toContain("APR: 20.74%");
    expect(rendered).toContain("Minimum payment: $117.00");
    expect(rendered).toContain("Core Numbers");
    expect(rendered).toContain("tasks: review payment timing");
    expect(rendered).not.toMatch(/\*\*|###|tasks:\*/);
  });

  it("normalizes malformed Budget comparison and separation markdown", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "Rent: $900.00. This is only** 25.6%** of your income. Keeping housing low is a financial advantage.**",
              "Subscriptions: $177.65 spent —** $77.65 Over . You paid StoryNest Audio** ($18.99 and $14.95).**",
              "Until you clarify these, they represent leakage:**",
              "MJP Services for** $184.00**",
              "Summit Trail Credit Payment: $110.00**",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("only 25.6%");
    expect(rendered).toContain("financial advantage.");
    expect(rendered).toContain("Subscriptions: $177.65 spent - $77.65 Over");
    expect(rendered).toContain("StoryNest Audio ($18.99 and $14.95).");
    expect(rendered).toContain("leakage:");
    expect(rendered).toContain("MJP Services for $184.00");
    expect(rendered).toContain("Summit Trail Credit Payment: $110.00");
    expect(rendered).not.toContain("**");
    expect(rendered).not.toContain("—**");
  });

  it("softens Roth contribution directives and keeps simple intake lists out of code formatting", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "If you are currently contributing, we should pause those contributions immediately once we confirm the numbers.",
              "There is no investment fund on earth that will reliably grow at 20% to 30% a year.",
              "Contributions (withdrawable tax/penalty-free) stay invested. Earnings stay invested.",
              "The Big Five Rough Guess:",
              " *   Utilities/Power",
              " *   Phone/Internet",
            ].join("\n"),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("one option to review after we confirm the numbers");
    expect(rendered).toContain("High-interest card APRs can outweigh expected investment returns");
    expect(rendered).toContain("For this plan, treat the Roth IRA as outside the short-term cash-flow work");
    expect(rendered).toContain("It is not a funding source for rent, the emergency cushion, or credit-card payoff");
    expect(rendered).toContain("No Roth IRA contribution, withdrawal, balance, or investment action is part of this plan");
    expect(rendered).toContain("Utilities/Power");
    expect(rendered).toContain("Phone/Internet");
    expect(screen.queryByText("Copy code")).not.toBeInTheDocument();
    expect(rendered).not.toMatch(/pause those contributions immediately|no investment fund on earth|stay invested|tax\/penalty-free|withdrawable|withdrawal mechanics/i);
  });

  it("removes latest Roth preservation and withdrawal phrasing from chat", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content:
              "The Roth IRA is not a funding source for this Finance plan. We will preserve those retirement assets as they are, without touching or withdrawing them. High-interest debt is best faced by optimizing monthly cash flow margin rather than depleting investment accounts.",
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("For this plan, treat the Roth IRA as outside the short-term cash-flow work");
    expect(rendered).toContain("It is not a funding source for rent, the emergency cushion, or credit-card payoff");
    expect(rendered).toContain("No Roth IRA contribution, withdrawal, balance, or investment action is part of this plan");
    expect(rendered).not.toMatch(/preserve those retirement assets|touching|withdrawing|depleting investment accounts/i);
  });

  it("turns Finance landscape table summaries into bullet-style owner copy", () => {
    render(
      <MessageList
        messages={[
          {
            id: "a-1",
            role: "assistant",
            content: [
              "Done — I saved this to Your Goals with every estimate and gap labeled explicitly.",
              "Constraints, tradeoffs, risks, unknowns — summarized: | Category | What it means for you | | ---------- | ---------------------- | | Info gaps | No exact APRs, minimums, or per-card balances — statements unopened. | | Behavioral loop | Stress creates avoidance. | | Cash-flow fog | $900 rent + unknown minimums = unclear cash flow. |",
              "Critical missing evidence (next actions): Credit-card statements/app screenshots: balance, APR, minimum, due date per card",
            ].join(" "),
          },
        ]}
      />
    );

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("I saved this to Your Goals");
    expect(rendered).toContain("Key constraints:");
    expect(rendered).toContain("APRs and minimum payments are still missing");
    expect(rendered).toContain("Statement avoidance is part of the plan");
    expect(rendered).toContain("Cash flow is unclear");
    expect(rendered).toContain("Critical missing evidence");
    expect(rendered).not.toContain("| Category |");
    expect(rendered).not.toContain("| ---------- |");
    expect(rendered).not.toMatch(/\|\s*What it means for you\s*\|/i);
  });
});
