import { buildInterfaceContext } from "./interface-context";

describe("buildInterfaceContext", () => {
  it("describes the general conversation without page or document details", () => {
    expect(
      buildInterfaceContext({
        projectId: "your-agent",
        projectName: "Your Agent",
      })
    ).toEqual({
      location: "your-agent",
      screen: "conversation",
    });
  });

  it("describes a page in owner language", () => {
    expect(
      buildInterfaceContext({
        projectId: "finance",
        projectName: "Finance",
      })
    ).toEqual({
      location: "page",
      screen: "conversation",
      page: {
        id: "finance",
        name: "Your Finance",
      },
    });
  });

  it("includes only document identity and edit state when a document is open", () => {
    expect(
      buildInterfaceContext({
        projectId: "finance",
        projectName: "Finance",
        document: {
          name: "plan.md",
          path: "/documents\\finance\\plan.md",
          state: "editing",
        },
      })
    ).toEqual({
      location: "page",
      screen: "document",
      page: {
        id: "finance",
        name: "Your Finance",
      },
      document: {
        name: "plan.md",
        path: "documents/finance/plan.md",
        state: "editing",
      },
    });
  });
});
