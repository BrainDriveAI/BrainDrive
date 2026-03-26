import type { IntentPlan } from "./types.js";

export function buildIntentGuidanceBlock(plan: IntentPlan): string {
  if (plan.policy === "pass_through") {
    return "";
  }

  const lines: string[] = [
    "# Intent Guidance",
    `Action Category: ${plan.action_category}`,
    `Policy: ${plan.policy}`,
    `Objective: ${plan.objective}`,
    `Workflow Profile: ${plan.workflow_profile?.id ?? "none"}`,
    `Confidence: ${plan.confidence.toFixed(2)}`,
  ];

  if (plan.suggested_capabilities.length > 0) {
    lines.push(`Suggested Capabilities: ${plan.suggested_capabilities.join(", ")}`);
  }

  if (plan.suggested_tools.length > 0) {
    lines.push(`Suggested Tools: ${plan.suggested_tools.join(", ")}`);
  }

  if (plan.progress_steps.length > 0) {
    lines.push("Progress Steps:");
    for (let index = 0; index < plan.progress_steps.length; index += 1) {
      lines.push(`${index + 1}. ${plan.progress_steps[index]}`);
    }
  }

  lines.push("Rules:");
  lines.push("1. Keep responses evidence-based and do not claim unexecuted actions.");
  lines.push("2. Keep approval gates intact for mutation or risky actions.");
  lines.push("3. Prefer concise progress updates before final synthesis.");

  if (plan.workflow_profile?.id === "interview") {
    lines.push("4. Ask exactly one focused question this turn unless the user asks to stop.");
    lines.push("5. Adapt the next question to the user's previous answer.");
  }

  return `${lines.join("\n")}\n`;
}

export function appendIntentGuidance(basePrompt: string, plan: IntentPlan): string {
  const guidance = buildIntentGuidanceBlock(plan);
  if (guidance.length === 0) {
    return basePrompt;
  }

  return `${basePrompt.trim()}\n\n${guidance}`;
}
