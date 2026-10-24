// The Experts and skills prototype (spec v0.8) is not in the gateway yet. These exports route to
// the prototype mock; see src/prototype/expertsMock.ts for the single enabling flag.
import { EXPERTS_MOCK_ENABLED } from "@/prototype/expertsMock";

export const expertPreviewEnabled = EXPERTS_MOCK_ENABLED;
export * from "@/prototype/expertsMock";
