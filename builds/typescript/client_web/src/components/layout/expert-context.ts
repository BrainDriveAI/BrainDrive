import type { Project } from "@/types/ui";

// UI orientation only: never added to prompts, instructions, or chat messages.
export function expertPurpose(project: Project): string {
  if (project.id === "start-a-business") return "Explore your business idea and plan practical next steps.";
  return `Keep your goals, progress, and work for ${project.name} together.`;
}
