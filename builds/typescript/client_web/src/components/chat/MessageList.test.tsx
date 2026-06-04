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
              "This is perfect data with a fully completed actuals ledger. Everything is completely reconciled and permanently mapped behind the scenes. Send extra cash directly to destroy the Northbridge Visa and get the banks' hands out of your pockets.",
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
    expect(rendered).not.toMatch(/perfect data|fully completed actuals ledger|completely reconciled|permanently mapped|behind the scenes|destroy the Northbridge Visa|banks' hands out of your pockets/i);
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
    expect(rendered).toContain("Utilities/Power");
    expect(rendered).toContain("Phone/Internet");
    expect(screen.queryByText("Copy code")).not.toBeInTheDocument();
    expect(rendered).not.toMatch(/pause those contributions immediately|no investment fund on earth/i);
  });
});
