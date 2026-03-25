import { useEffect, useMemo, useRef, useState } from "react";

import {
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  renameProject as apiRenameProject,
  getProjectFiles,
  listProjects
} from "@/api/gateway-adapter";
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
  addProject: (name: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
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
    setIsLoadingProjects(true);
    setProjectsError(null);

    void (async () => {
      try {
        const nextProjects = await listProjects();

        if (projectsRequestIdRef.current !== requestId) {
          return;
        }

        setProjects(nextProjects);

        // Auto-select BD+1 as landing page if no project is selected
        if (!selectedProjectId) {
          const bdPlusOne = nextProjects.find(p => p.id === "braindrive-plus-one");
          if (bdPlusOne) {
            setSelectedProjectId("braindrive-plus-one");
          }
        }
      } catch (error) {
        if (projectsRequestIdRef.current !== requestId) {
          return;
        }

        setProjects([]);
        setProjectsError(toError(error));
      } finally {
        if (projectsRequestIdRef.current === requestId) {
          setIsLoadingProjects(false);
        }
      }
    })();
  }

  useEffect(() => {
    refreshProjects();
  }, []);

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setProjectFiles([]);
    setIsLoadingFiles(true);
    setFilesError(null);

    const requestId = filesRequestIdRef.current + 1;
    filesRequestIdRef.current = requestId;

    void (async () => {
      try {
        const nextFiles = await getProjectFiles(id);

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

  function deselectProject() {
    filesRequestIdRef.current += 1;
    setSelectedProjectId(null);
    setProjectFiles([]);
    setFilesError(null);
    setIsLoadingFiles(false);
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
    addProject,
    removeProject,
    renameProject: renameProjectFn
  };
}
