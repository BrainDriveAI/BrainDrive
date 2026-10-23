// Expert create and install are not in the gateway yet. These exports route to the
// prototype mock; see src/prototype/expertsMock.ts for the single enabling flag.
import { EXPERTS_MOCK_ENABLED, STARTER_SOURCE, mockCreateExpert, mockInstallExpert, mockReviewExpert } from "@/prototype/expertsMock";

export const expertPreviewEnabled = EXPERTS_MOCK_ENABLED;
export { STARTER_SOURCE };
export type ExpertReview = {
  manifest: { id: string; name: string; description: string; version: string; creator: string; licence: string; page: string; skills: string[]; testedIn: string[] };
  files: Record<string, string>; digest: string; source: string; conflicts: string[]; existingProjectId?: string; verification: string; permissions: string;
};
export const createExpert = mockCreateExpert;
export const reviewExpert = (source: string) => mockReviewExpert(source);
export const installExpert = (review: ExpertReview) => mockInstallExpert(review);
