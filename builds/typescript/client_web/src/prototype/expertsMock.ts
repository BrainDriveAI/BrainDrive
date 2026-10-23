// PROTOTYPE ONLY. The gateway has no Expert install/create/review endpoints yet, so the
// Add Expert and Remove Expert screens call these stand-ins instead. Nothing here touches
// the back end except the existing project create call, which gives each new Expert a
// real, clickable page in the sidebar.
//
// One switch controls all of it: Experts UI is shown in `npm run dev` and hidden in
// production builds. Set VITE_EXPERTS_MOCK=false in client_web/.env.development.local to hide it.
import { createProject } from "@/api/gateway-adapter";
import type { ExpertReview } from "@/api/experts";

export const EXPERTS_MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_EXPERTS_MOCK !== "false";

const STARTER_SOURCE = "starter-expert.zip";
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 350));

function readableName(source: string): string {
  const base = source.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "New Expert";
}

export async function mockCreateExpert(): Promise<{ id: string }> {
  await pause();
  return { id: (await createProject("New Expert")).id };
}

export async function mockReviewExpert(source: string): Promise<ExpertReview> {
  await pause();
  const name = source === STARTER_SOURCE ? "Start a Business" : readableName(source);
  return {
    manifest: {
      id: name.toLowerCase().replace(/\s+/g, "-"), name, version: "0.1.0",
      description: "Sample description shown while the Expert library is being designed.",
      creator: "Sample Author", licence: "MIT", page: name, skills: [], testedIn: [],
    },
    digest: "sample-fingerprint-not-real",
    source,
    conflicts: [],
    files: { "AGENT.md": "Sample instructions. The real package text will appear here.", "LICENSE.txt": "Sample licence text." },
    verification: "Not checked. This is a sample screen.",
    permissions: "This Expert only works inside its own page.",
  };
}

export async function mockInstallExpert(review: ExpertReview): Promise<{ projectId: string }> {
  await pause();
  return { projectId: (await createProject(review.manifest.name)).id };
}

export { STARTER_SOURCE };
