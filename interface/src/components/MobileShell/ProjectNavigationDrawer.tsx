import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ButtonPlus, Text } from "@cypher-asi/zui";
import { useShallow } from "zustand/react/shallow";
import { PanelSearch } from "../PanelSearch";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { getRecentProjects, useProjectsListStore } from "../../stores/projects-list-store";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import {
  getMobileProjectDestination,
  getProjectIdFromPathname,
  projectWorkRoute,
  projectStatsRoute,
} from "../../utils/mobileNavigation";
import { resolveProjectAgentPath } from "./mobile-shell-utils";
import styles from "./MobileShell.module.css";

function ProjectRow({
  project,
  isActive,
  onOpen,
}: {
  project: { project_id: string; name: string; description?: string | null };
  isActive: boolean;
  onOpen: (projectId: string) => void;
}) {
  return (
    <button
      key={project.project_id}
      type="button"
      className={`${styles.mobileProjectDrawerRow} ${isActive ? styles.mobileProjectDrawerRowActive : ""}`}
      aria-label={`Open ${project.name}`}
      onClick={() => onOpen(project.project_id)}
    >
      <span className={styles.mobileProjectDrawerRowMain}>
        <span className={styles.mobileProjectDrawerTitle}>{project.name}</span>
        <span className={styles.mobileProjectDrawerRowMeta}>
          {project.description?.trim() || "Open this project."}
        </span>
      </span>
    </button>
  );
}

export function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch();
  const { openNewProjectModal, projects } = useProjectsListStore(
    useShallow((state) => ({
      openNewProjectModal: state.openNewProjectModal,
      projects: state.projects,
    })),
  );
  const navigate = useNavigate();
  const location = useLocation();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const mobileDestination = getMobileProjectDestination(location.pathname);
  const recentProjects = useMemo(() => getRecentProjects(projects), [projects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = `${project.name} ${project.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [projects, query]);

  const openProjectLanding = useCallback((projectId: string) => {
    if (projectId !== currentProjectId) {
      closePreview();
    }

    openAfterDrawerClose(() => {
      if (mobileDestination === "tasks") {
        navigate(projectWorkRoute(projectId));
        return;
      }

      if (mobileDestination === "stats") {
        navigate(projectStatsRoute(projectId));
        return;
      }

      navigate(resolveProjectAgentPath(projectId));
    });
  }, [currentProjectId, mobileDestination, navigate, openAfterDrawerClose, closePreview]);

  const currentProject = currentProjectId
    ? projects.find((project) => project.project_id === currentProjectId) ?? null
    : null;

  const activeQuery = query.trim();
  const recentProjectIds = new Set(recentProjects.map((project) => project.project_id));
  const recentRows = filteredProjects.filter((project) =>
    project.project_id !== currentProjectId && recentProjectIds.has(project.project_id),
  );
  const remainingRows = filteredProjects.filter((project) =>
    project.project_id !== currentProjectId && !recentProjectIds.has(project.project_id),
  );
  const hasCurrentProject = Boolean(currentProjectId);
  const recentSectionTitle = hasCurrentProject || remainingRows.length > 0 ? "Recent projects" : "Projects";
  const remainingSectionTitle = recentRows.length > 0 ? "Other projects" : "Projects";

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <PanelSearch
          placeholder="Search Projects..."
          value={query}
          onChange={setQuery}
          action={<ButtonPlus onClick={() => openAfterDrawerClose(openNewProjectModal)} size="sm" title="New Project" />}
        />
      </div>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileProjectDrawerList} role="tree" aria-label="Project navigation">
          {currentProject && (!activeQuery || filteredProjects.some((project) => project.project_id === currentProject.project_id)) ? (
            <section className={styles.mobileDrawerSection}>
              <div className={styles.mobileDrawerSectionHeader}>
                <span className={styles.mobileDrawerSectionTitle}>Current project</span>
              </div>
              <section
                className={`${styles.mobileProjectDrawerCard} ${styles.mobileProjectDrawerCardActive}`}
              >
                <button
                  type="button"
                  role="treeitem"
                  aria-label={currentProject.name}
                  aria-selected
                  className={styles.mobileProjectDrawerPrimary}
                  onClick={() => openProjectLanding(currentProject.project_id)}
                >
                  <span className={styles.mobileProjectDrawerTitle}>{currentProject.name}</span>
                  <span className={styles.mobileProjectDrawerDescription}>
                    {currentProject.description?.trim() || "Open this project and keep working in the current tab."}
                  </span>
                </button>
              </section>
            </section>
          ) : null}

          {activeQuery ? (
            <section className={styles.mobileDrawerSection}>
              <div className={styles.mobileDrawerSectionHeader}>
                <span className={styles.mobileDrawerSectionTitle}>Results</span>
                <span className={styles.mobileDrawerSectionCount}>{filteredProjects.length}</span>
              </div>
              <div className={styles.mobileProjectDrawerStack}>
                {filteredProjects
                  .filter((project) => project.project_id !== currentProjectId)
                  .map((project) => (
                    <ProjectRow
                      key={project.project_id}
                      project={project}
                      isActive={project.project_id === currentProjectId}
                      onOpen={openProjectLanding}
                    />
                  ))}
              </div>
            </section>
          ) : (
            <>
              {recentRows.length > 0 ? (
                <section className={styles.mobileDrawerSection}>
                  <div className={styles.mobileDrawerSectionHeader}>
                    <span className={styles.mobileDrawerSectionTitle}>{recentSectionTitle}</span>
                    <span className={styles.mobileDrawerSectionCount}>{recentRows.length}</span>
                  </div>
                  <div className={styles.mobileProjectDrawerStack}>
                    {recentRows.map((project) => (
                      <ProjectRow
                        key={project.project_id}
                        project={project}
                        isActive={project.project_id === currentProjectId}
                        onOpen={openProjectLanding}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {remainingRows.length > 0 ? (
                <section className={styles.mobileDrawerSection}>
                  <div className={styles.mobileDrawerSectionHeader}>
                    <span className={styles.mobileDrawerSectionTitle}>{remainingSectionTitle}</span>
                    <span className={styles.mobileDrawerSectionCount}>{remainingRows.length}</span>
                  </div>
                  <div className={styles.mobileProjectDrawerStack}>
                    {remainingRows.map((project) => (
                      <ProjectRow
                        key={project.project_id}
                        project={project}
                        isActive={project.project_id === currentProjectId}
                        onOpen={openProjectLanding}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}

          {filteredProjects.length === 0 ? (
            <div className={styles.mobileDrawerEmptyState}>
              <Text variant="muted" size="sm">
                No projects match "{query}".
              </Text>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
