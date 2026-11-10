import { projectDisplayLabel } from "@/components/layout/sidebar-labels";
import { isRootAgentProjectId } from "@/lib/rootAgent";

export type InterfaceScreen = "conversation" | "document";
export type InterfaceDocumentState = "viewing" | "editing";

export type InterfaceContext = {
  location: "your-agent" | "page";
  screen: InterfaceScreen;
  page?: {
    id: string;
    name: string;
  };
  document?: {
    name: string;
    path: string;
    state: InterfaceDocumentState;
  };
};

export function buildInterfaceContext(input: {
  projectId: string | null;
  projectName?: string | null;
  document?: {
    name: string;
    path: string;
    state: InterfaceDocumentState;
  } | null;
}): InterfaceContext {
  const isYourAgent = isRootAgentProjectId(input.projectId);
  const context: InterfaceContext = {
    location: isYourAgent ? "your-agent" : "page",
    screen: input.document ? "document" : "conversation",
  };

  if (!isYourAgent && input.projectId) {
    context.page = {
      id: input.projectId,
      name: projectDisplayLabel(input.projectId, input.projectName ?? input.projectId),
    };
  }

  if (input.document) {
    context.document = {
      name: input.document.name,
      path: normalizeDocumentPath(input.document.path),
      state: input.document.state,
    };
  }

  return context;
}

function normalizeDocumentPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
