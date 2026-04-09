import { act, renderHook, waitFor } from "@testing-library/react";

import type { Project, ProjectFile } from "@/types/ui";

import { useProjects } from "./useProjects";

const listProjectsMock = vi.fn<() => Promise<Project[]>>();
const getProjectFilesMock = vi.fn<(projectId: string) => Promise<ProjectFile[]>>();
const createProjectMock = vi.fn<(name: string) => Promise<Project>>();
const deleteProjectMock = vi.fn<(id: string) => Promise<void>>();
const renameProjectMock = vi.fn<(id: string, name: string) => Promise<void>>();

vi.mock("@/api/gateway-adapter", () => ({
  listProjects: () => listProjectsMock(),
  getProjectFiles: (projectId: string) => getProjectFilesMock(projectId),
  createProject: (name: string) => createProjectMock(name),
  deleteProject: (id: string) => deleteProjectMock(id),
  renameProject: (id: string, name: string) => renameProjectMock(id, name),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultProjects: Project[] = [
  {
    id: "braindrive-plus-one",
    name: "BrainDrive+1",
    icon: "sparkles",
    conversationId: "conv-plus-one",
  },
  {
    id: "finance",
    name: "Finance",
    icon: "dollar-sign",
    conversationId: "conv-finance",
  },
];

describe("useProjects", () => {
  beforeEach(() => {
    listProjectsMock.mockReset();
    getProjectFilesMock.mockReset();
    createProjectMock.mockReset();
    deleteProjectMock.mockReset();
    renameProjectMock.mockReset();

    listProjectsMock.mockResolvedValue(defaultProjects);
    getProjectFilesMock.mockResolvedValue([]);
    createProjectMock.mockResolvedValue(defaultProjects[1]!);
    deleteProjectMock.mockResolvedValue();
    renameProjectMock.mockResolvedValue();
  });

  it("does not show projects loading state during background refreshes", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.isLoadingProjects).toBe(false);
    });

    const nextRefresh = deferred<Project[]>();
    listProjectsMock.mockReturnValueOnce(nextRefresh.promise);

    act(() => {
      result.current.refreshProjects();
    });

    expect(result.current.isLoadingProjects).toBe(false);

    nextRefresh.resolve(defaultProjects);

    await waitFor(() => {
      expect(listProjectsMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not re-fetch files when selecting the active project", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.selectedProjectId).toBe("braindrive-plus-one");
      expect(result.current.isLoadingFiles).toBe(false);
    });

    expect(getProjectFilesMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.selectProject("braindrive-plus-one");
    });

    expect(getProjectFilesMock).toHaveBeenCalledTimes(1);
    expect(result.current.isLoadingFiles).toBe(false);
  });
});
