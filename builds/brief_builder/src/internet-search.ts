export const BRIEF_INTERNET_SEARCH_OPERATIONS = Object.freeze([
  { operationId: "web.search@1", capabilityName: "web.search", label: "Search" },
  { operationId: "web.read@1", capabilityName: "web.read", label: "Read" },
] as const);

export type BriefInternetSearchOperationId = typeof BRIEF_INTERNET_SEARCH_OPERATIONS[number]["operationId"];

export type BriefExternalUntrustedSourceInput = {
  requestedUrl: string;
  canonicalUrl: string;
  title: string | null;
  retrievedAt: string;
  providerAttribution: string;
  content: string;
};

export function buildExternalUntrustedSourceMaterial(input: BriefExternalUntrustedSourceInput): string {
  return [
    "External untrusted source material",
    `Trust: external-untrusted`,
    `Requested URL: ${input.requestedUrl}`,
    `Canonical URL: ${input.canonicalUrl}`,
    `Title: ${input.title ?? "Unavailable"}`,
    `Retrieved at: ${input.retrievedAt}`,
    `Provider attribution: ${input.providerAttribution}`,
    "",
    input.content,
  ].join("\n");
}

export function isBriefInternetSearchOperationId(value: unknown): value is BriefInternetSearchOperationId {
  return value === "web.search@1" || value === "web.read@1";
}
