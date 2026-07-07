import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearProjectConversation as apiClearProjectConversation,
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  renameProject as apiRenameProject,
  getProjectFiles,
  listProjects
} from "@/api/gateway-adapter";
import {
  ROOT_AGENT_PROJECT_ID,
  canonicalizeRootAgentProjectId,
  normalizeRootAgentProjects,
} from "@/lib/rootAgent";
import type { Project, ProjectFile } from "@/types/ui";

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function useProjects(): {
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  projectFiles: ProjectFile[];
  isLoadingProjects: boolean;
  isLoadingFiles: boolean;
  activeConversationId: string | null;
  projectsError: Error | null;
  filesError: Error | null;
  selectProject: (id: string) => void;
  deselectProject: () => void;
  refreshProjects: () => void;
  refreshSelectedProjectFiles: () => Promise<ProjectFile[]>;
  addProject: (name: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  clearProjectConversation: (id: string) => Promise<void>;
} {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [projectsError, setProjectsError] = useState<Error | null>(null);
  const [filesError, setFilesError] = useState<Error | null>(null);

  const projectsRequestIdRef = useRef(0);
  const filesRequestIdRef = useRef(0);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const activeConversationId = selectedProject?.conversationId ?? null;

  function refreshProjects() {
    const requestId = projectsRequestIdRef.current + 1;
    projectsRequestIdRef.current = requestId;
    const shouldShowLoadingState = projects.length === 0;

    if (shouldShowLoadingState) {
      setIsLoadingProjects(true);
    }

    setProjectsError(null);

    void (async () => {
      try {
        const nextProjects = normalizeRootAgentProjects(await listProjects());

        if (projectsRequestIdRef.current !== requestId) {
          return;
        }

        setProjects(nextProjects);
      } catch (error) {
        if (projectsRequestIdRef.current !== requestId) {
          return;
        }

        if (shouldShowLoadingState) {
          setProjects([]);
        }

        setProjectsError(toError(error));
      } finally {
        if (projectsRequestIdRef.current === requestId && shouldShowLoadingState) {
          setIsLoadingProjects(false);
        }
      }
    })();
  }

  const hasAutoSelectedRef = useRef(false);

  useEffect(() => {
    refreshProjects();
  }, []);

  useEffect(() => {
    if (
      projects.length > 0 &&
      selectedProjectId === null &&
      !hasAutoSelectedRef.current
    ) {
      const rootAgent = projects.find((project) => project.id === ROOT_AGENT_PROJECT_ID);
      if (rootAgent) {
        hasAutoSelectedRef.current = true;
        selectProject(rootAgent.id);
      }
    }
  }, [projects, selectedProjectId]);

  function selectProject(id: string) {
    const effectiveProjectId = canonicalizeRootAgentProjectId(id);
    if (effectiveProjectId === selectedProjectId) {
      return;
    }

    setSelectedProjectId(effectiveProjectId);
    setProjectFiles([]);
    setIsLoadingFiles(true);
    setFilesError(null);

    const requestId = filesRequestIdRef.current + 1;
    filesRequestIdRef.current = requestId;

    void (async () => {
      try {
        const nextFiles = await getProjectFiles(effectiveProjectId);

        if (filesRequestIdRef.current !== requestId) {
          return;
        }

        setProjectFiles(nextFiles);
      } catch (error) {
        if (filesRequestIdRef.current !== requestId) {
          return;
        }

        setProjectFiles([]);
        setFilesError(toError(error));
      } finally {
        if (filesRequestIdRef.current === requestId) {
          setIsLoadingFiles(false);
        }
      }
    })();
  }

  async function refreshSelectedProjectFiles(): Promise<ProjectFile[]> {
    if (!selectedProjectId) {
      return [];
    }

    setIsLoadingFiles(true);
    setFilesError(null);
    const requestId = filesRequestIdRef.current + 1;
    filesRequestIdRef.current = requestId;

    try {
      const nextFiles = await getProjectFiles(selectedProjectId);
      if (filesRequestIdRef.current === requestId) {
        setProjectFiles(nextFiles);
      }
      return nextFiles;
    } catch (error) {
      if (filesRequestIdRef.current === requestId) {
        setProjectFiles([]);
        setFilesError(toError(error));
      }
      throw error;
    } finally {
      if (filesRequestIdRef.current === requestId) {
        setIsLoadingFiles(false);
      }
    }
  }

  function deselectProject() {
    selectProject(ROOT_AGENT_PROJECT_ID);
  }

  async function addProject(name: string) {
    const created = await apiCreateProject(name);
    refreshProjects();
    selectProject(created.id);
  }

  async function removeProject(id: string) {
    await apiDeleteProject(id);

    if (selectedProjectId === id) {
      deselectProject();
    }

    refreshProjects();
  }

  async function renameProjectFn(id: string, name: string) {
    await apiRenameProject(id, name);
    refreshProjects();
  }

  async function clearProjectConversation(id: string) {
    const effectiveProjectId = canonicalizeRootAgentProjectId(id);
    await apiClearProjectConversation(effectiveProjectId);
    setProjects((current) =>
      current.map((project) =>
        project.id === effectiveProjectId ? { ...project, conversationId: null } : project
      )
    );
    refreshProjects();
  }

  return {
    projects,
    selectedProjectId,
    selectedProject,
    projectFiles,
    isLoadingProjects,
    isLoadingFiles,
    activeConversationId,
    projectsError,
    filesError,
    selectProject,
    deselectProject,
    refreshProjects,
    refreshSelectedProjectFiles,
    addProject,
    removeProject,
    renameProject: renameProjectFn,
    clearProjectConversation
  };
}
