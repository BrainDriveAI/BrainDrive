import { authenticatedFetch } from "./auth-adapter";

export type OwnerFailureSurface = "model" | "render" | "export";

export async function reportOwnerFailure(input: {
  operationId: string;
  surface: OwnerFailureSurface;
  operation: string;
  safeMessage: string;
  failureCode?: string | null;
}): Promise<void> {
  const response = await authenticatedFetch("/api/diagnostics/owner-failures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation_id: input.operationId,
      surface: input.surface,
      operation: input.operation,
      safe_message: input.safeMessage,
      ...(input.failureCode ? { failure_code: input.failureCode } : {}),
    }),
  });
  if (!response.ok) return;
}
