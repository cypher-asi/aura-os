import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { PanelSearch } from "../PanelSearch";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { getRecentProjects, useProjectsListStore } from "../../stores/projects-list-store";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import {
  getMobileProjectDestination,
  getProjectIdFromPathname,
  projectProcessRoute,
  projectTasksRoute,
  projectWorkRoute,
  projectStatsRoute,
} from "../../utils/mobileNavigation";
import { setLastProject } from "../../utils/storage";
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
        {project.description?.trim() ? (
          <span className={styles.mobileProjectDrawerRowMeta}>
            {project.description.trim()}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch("projects");
  const projects = useProjectsListStore((state) => state.projects);
  const navigate = useNavigate();
  const location = useLocation();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
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

  const runDrawerNavigation = useCallback((path: string) => {
    navigate(path);
    closeDrawers();
  }, [closeDrawers, navigate]);

  const openProjectLanding = useCallback((projectId: string) => {
    if (projectId !== currentProjectId) {
      closePreview();
    }

    setLastProject(projectId);

    if (mobileDestination === "tasks") {
      runDrawerNavigation(projectTasksRoute(projectId));
      return;
    }

    if (mobileDestination === "execution") {
      runDrawerNavigation(projectWorkRoute(projectId));
      return;
    }

    if (mobileDestination === "process") {
      runDrawerNavigation(projectProcessRoute(projectId));
      return;
    }

    if (mobileDestination === "stats") {
      runDrawerNavigation(projectStatsRoute(projectId));
      return;
    }

    runDrawerNavigation(resolveProjectAgentPath(projectId));
  }, [currentProjectId, mobileDestination, runDrawerNavigation, closePreview]);

  const activeQuery = query.trim();
  const recentProjectIds = new Set(recentProjects.map((project) => project.project_id));
  const projectRows = filteredProjects
    .filter((project) => project.project_id !== currentProjectId)
    .sort((left, right) => {
      const leftIsRecent = recentProjectIds.has(left.project_id);
      const rightIsRecent = recentProjectIds.has(right.project_id);
      if (leftIsRecent !== rightIsRecent) {
        return leftIsRecent ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <div className={styles.mobileDrawerHeaderBar}>
          <div className={styles.mobileDrawerHeaderTitle}>Switch project</div>
          <div className={styles.mobileDrawerHeaderActions}>
            <button
              type="button"
              className={styles.mobileDrawerDoneButton}
              aria-label="Close project navigation"
              onClick={() => setNavOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
        <PanelSearch
          placeholder="Search Projects..."
          value={query}
          onChange={setQuery}
        />
      </div>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileProjectDrawerList} role="tree" aria-label="Project navigation">
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
              {projectRows.length > 0 ? (
                <section className={styles.mobileDrawerSection}>
                  <div className={styles.mobileDrawerSectionHeader}>
                    <span className={styles.mobileDrawerSectionTitle}>Projects</span>
                    <span className={styles.mobileDrawerSectionCount}>{projectRows.length}</span>
                  </div>
                  <div className={styles.mobileProjectDrawerStack}>
                    {projectRows.map((project) => (
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
