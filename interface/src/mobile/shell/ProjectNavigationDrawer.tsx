import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { api } from "../../api/client";
import { PanelSearch } from "../../components/PanelSearch";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useOrgStore } from "../../stores/org-store";
import {
  getMobileProjectDestination,
  getProjectIdFromPathname,
  projectAgentsRoute,
  projectFilesRoute,
  projectProcessRoute,
  projectTasksRoute,
  projectWorkRoute,
  projectStatsRoute,
} from "../../utils/mobileNavigation";
import { setLastProject } from "../../utils/storage";
import type { Org, Project } from "../../shared/types";
import styles from "./MobileShell.module.css";

type DrawerOrg = Pick<Org, "org_id" | "name">;

function projectMatches(project: Project, query: string): boolean {
  const haystack = `${project.name} ${project.description ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at ?? "");
    const rightTime = Date.parse(right.updated_at ?? "");
    const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
    const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
    if (safeLeftTime !== safeRightTime) {
      return safeRightTime - safeLeftTime;
    }
    return left.name.localeCompare(right.name);
  });
}

function areSameProjects(left: Project[] | undefined, right: Project[]): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }

  return left.every((project, index) => {
    const nextProject = right[index];
    return project.project_id === nextProject.project_id
      && project.name === nextProject.name
      && project.updated_at === nextProject.updated_at;
  });
}

function ProjectRow({
  project,
  isActive,
  onOpen,
}: {
  project: Project;
  isActive: boolean;
  onOpen: (project: Project) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.mobileProjectDrawerRow} ${isActive ? styles.mobileProjectDrawerRowActive : ""}`}
      aria-current={isActive ? "page" : undefined}
      aria-label={`${isActive ? "Current project, " : ""}Open ${project.name}`}
      onClick={() => onOpen(project)}
    >
      <span className={styles.mobileProjectDrawerRowMain}>
        <span className={styles.mobileProjectDrawerTitle}>{project.name}</span>
      </span>
    </button>
  );
}

export function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch("projects");
  const projects = useProjectsListStore((state) => state.projects);
  const orgs = useOrgStore((state) => state.orgs);
  const activeOrg = useOrgStore((state) => state.activeOrg);
  const switchOrg = useOrgStore((state) => state.switchOrg);
  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const mobileDestination = getMobileProjectDestination(location.pathname);
  const [projectsByOrgId, setProjectsByOrgId] = useState<Record<string, Project[]>>({});
  const [loadingOrgIds, setLoadingOrgIds] = useState<Record<string, boolean>>({});
  const [failedOrgIds, setFailedOrgIds] = useState<Record<string, boolean>>({});
  const [collapsedOrgIds, setCollapsedOrgIds] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const requestedOrgIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);

  const orgSummaries = useMemo<DrawerOrg[]>(() => {
    const byId = new Map<string, DrawerOrg>();
    for (const org of orgs) {
      byId.set(org.org_id, { org_id: org.org_id, name: org.name });
    }
    for (const project of projects) {
      if (byId.has(project.org_id)) continue;
      byId.set(project.org_id, {
        org_id: project.org_id,
        name: project.org_id === activeOrg?.org_id ? activeOrg?.name ?? "Current org" : "Organization",
      });
    }
    return Array.from(byId.values()).sort((left, right) => {
      if (left.org_id === activeOrg?.org_id) return -1;
      if (right.org_id === activeOrg?.org_id) return 1;
      return left.name.localeCompare(right.name);
    });
  }, [activeOrg?.name, activeOrg?.org_id, orgs, projects]);

  useEffect(() => {
    if (projects.length === 0) return;
    const grouped = projects.reduce<Record<string, Project[]>>((acc, project) => {
      acc[project.org_id] = [...(acc[project.org_id] ?? []), project];
      return acc;
    }, {});

    setProjectsByOrgId((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [orgId, orgProjects] of Object.entries(grouped)) {
        const sortedProjects = sortProjects(orgProjects);
        if (!areSameProjects(previous[orgId], sortedProjects)) {
          next[orgId] = sortedProjects;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [projects]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const drawerBody = drawerBodyRef.current;
    if (!drawerBody) return;

    if (typeof drawerBody.scrollTo === "function") {
      drawerBody.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    drawerBody.scrollTop = 0;
    drawerBody.scrollLeft = 0;
  }, [navOpen]);

  useEffect(() => {
    for (const org of orgSummaries) {
      if (projectsByOrgId[org.org_id] || failedOrgIds[org.org_id] || requestedOrgIdsRef.current.has(org.org_id)) {
        continue;
      }

      requestedOrgIdsRef.current.add(org.org_id);
      setLoadingOrgIds((previous) => ({ ...previous, [org.org_id]: true }));
      void api.listProjects(org.org_id)
        .then((orgProjects) => {
          if (!mountedRef.current) return;
          setProjectsByOrgId((previous) => ({
            ...previous,
            [org.org_id]: sortProjects(orgProjects),
          }));
          setFailedOrgIds((previous) => {
            if (!previous[org.org_id]) return previous;
            const next = { ...previous };
            delete next[org.org_id];
            return next;
          });
        })
        .catch((error) => {
          if (!mountedRef.current) return;
          console.error(`Failed to load projects for org ${org.org_id}`, error);
          setFailedOrgIds((previous) => ({ ...previous, [org.org_id]: true }));
        })
        .finally(() => {
          if (!mountedRef.current) return;
          setLoadingOrgIds((previous) => ({ ...previous, [org.org_id]: false }));
        });
    }
  }, [failedOrgIds, orgSummaries, projectsByOrgId]);

  const normalizedQuery = query.trim().toLowerCase();
  const knownProjects = useMemo(
    () => Object.values(projectsByOrgId).flat(),
    [projectsByOrgId],
  );
  const currentProject = knownProjects.find((project) => project.project_id === currentProjectId)
    ?? projects.find((project) => project.project_id === currentProjectId)
    ?? null;

  const sections = useMemo(() => {
    return orgSummaries
      .map((org) => {
        const orgProjects = projectsByOrgId[org.org_id] ?? [];
        const orgMatches = normalizedQuery.length > 0 && org.name.toLowerCase().includes(normalizedQuery);
        const visibleProjects = normalizedQuery.length === 0 || orgMatches
          ? orgProjects
          : orgProjects.filter((project) => projectMatches(project, normalizedQuery));

        return {
          org,
          projects: visibleProjects,
          totalProjects: orgProjects.length,
          isLoading: loadingOrgIds[org.org_id] === true,
          didFail: failedOrgIds[org.org_id] === true,
          shouldShow: normalizedQuery.length === 0 || orgMatches || visibleProjects.length > 0,
        };
      })
      .filter((section) => section.shouldShow);
  }, [failedOrgIds, loadingOrgIds, normalizedQuery, orgSummaries, projectsByOrgId]);
  const cypherSection = useMemo(
    () => sections.find((section) => /cypher/i.test(section.org.name)) ?? null,
    [sections],
  );
  const primarySections = useMemo(
    () => sections.filter((section) => section !== cypherSection),
    [cypherSection, sections],
  );

  const runDrawerNavigation = useCallback((path: string) => {
    navigate(path);
    closeDrawers();
  }, [closeDrawers, navigate]);

  const destinationPathForProject = useCallback((projectId: string) => {
    if (mobileDestination === "tasks") {
      return projectTasksRoute(projectId);
    }

    if (mobileDestination === "execution") {
      return projectWorkRoute(projectId);
    }

    if (mobileDestination === "files") {
      return projectFilesRoute(projectId);
    }

    if (mobileDestination === "process") {
      return projectProcessRoute(projectId);
    }

    if (mobileDestination === "stats") {
      return projectStatsRoute(projectId);
    }

    return projectAgentsRoute(projectId);
  }, [mobileDestination]);

  const openProjectLanding = useCallback((project: Project) => {
    if (project.project_id !== currentProjectId) {
      closePreview();
    }

    setLastProject(project.project_id);
    if (project.org_id !== activeOrg?.org_id) {
      const org = orgs.find((candidate) => candidate.org_id === project.org_id);
      if (org) {
        switchOrg(org);
      }
    }

    runDrawerNavigation(destinationPathForProject(project.project_id));
  }, [activeOrg?.org_id, closePreview, currentProjectId, destinationPathForProject, orgs, runDrawerNavigation, switchOrg]);

  const toggleOrg = useCallback((orgId: string) => {
    setCollapsedOrgIds((previous) => {
      const next = new Set(previous);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  }, []);

  const activeQuery = query.trim();
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, [setQuery]);

  const renderProjectSection = (section: (typeof sections)[number]) => {
    const isCollapsed = normalizedQuery.length === 0 && collapsedOrgIds.has(section.org.org_id);
    const isActiveOrg = section.org.org_id === activeOrg?.org_id;

    return (
      <section key={section.org.org_id} className={styles.mobileDrawerOrgSection}>
        <button
          type="button"
          className={`${styles.mobileDrawerOrgToggle} ${isActiveOrg ? styles.mobileDrawerOrgToggleActive : ""}`}
          aria-expanded={!isCollapsed}
          onClick={() => toggleOrg(section.org.org_id)}
        >
          <span className={styles.mobileDrawerOrgChevron}>
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <span className={styles.mobileDrawerOrgTitle}>{section.org.name}</span>
          <span className={styles.mobileDrawerOrgCount}>{section.totalProjects}</span>
        </button>

        {!isCollapsed ? (
          <div className={styles.mobileDrawerOrgProjects}>
            {section.projects.map((project) => (
              <ProjectRow
                key={project.project_id}
                project={project}
                isActive={project.project_id === currentProjectId}
                onOpen={openProjectLanding}
              />
            ))}
            {section.isLoading && section.projects.length === 0 ? (
              <div className={styles.mobileDrawerOrgStatus}>
                <Loader2 size={14} className="spin" />
                <Text size="sm" variant="muted">Loading projects…</Text>
              </div>
            ) : null}
            {section.didFail ? (
              <div className={styles.mobileDrawerOrgStatus}>
                <Text size="sm" variant="muted">Could not load this organization.</Text>
              </div>
            ) : null}
            {!section.isLoading && !section.didFail && section.projects.length === 0 ? (
              <div className={styles.mobileDrawerOrgStatus}>
                <Text size="sm" variant="muted">
                  {activeQuery ? "No matching projects." : "No projects yet."}
                </Text>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <div className={`${styles.mobileDrawerContent} ${styles.mobileProjectDrawerContent}`}>
      <div className={styles.mobileProjectDrawerTopbar}>
        <div className={styles.mobileProjectDrawerTopbarTitle}>
          AURA
        </div>
      </div>
      <div className={styles.mobileDrawerSearch}>
        <div className={styles.mobileDrawerHeaderBar}>
          <div>
            <div className={styles.mobileDrawerHeaderTitle}>
              {currentProject?.name ?? "Projects"}
            </div>
          </div>
          <button
            type="button"
            className={styles.mobileDrawerIconButton}
            aria-label={searchOpen ? "Close project search" : "Search projects"}
            onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
        </div>
        {searchOpen ? (
          <PanelSearch
            placeholder="Search projects..."
            value={query}
            onChange={setQuery}
          />
        ) : null}
      </div>
      <div className={styles.mobileDrawerBody} ref={drawerBodyRef}>
        <div className={styles.mobileDrawerOrgStack} role="tree" aria-label="Project navigation">
          {primarySections.map(renderProjectSection)}

          {sections.length === 0 ? (
            <div className={styles.mobileDrawerEmptyState}>
              <Text variant="muted" size="sm">
                No organizations or projects match "{query}".
              </Text>
            </div>
          ) : null}
        </div>
      </div>
      {cypherSection ? (
        <div className={styles.mobileProjectDrawerFooter}>
          <div className={styles.mobileCypherCard} aria-label="Cypher projects">
            <div className={styles.mobileCypherHeader}>
              <span className={styles.mobileCypherMark}>C</span>
              <span className={styles.mobileCypherCopy}>
                <span className={styles.mobileCypherTitle}>{cypherSection.org.name}</span>
                <span className={styles.mobileCypherMeta}>{cypherSection.totalProjects} projects</span>
              </span>
            </div>
            <div className={styles.mobileCypherProjects}>
              {cypherSection.projects.map((project) => (
                <ProjectRow
                  key={project.project_id}
                  project={project}
                  isActive={project.project_id === currentProjectId}
                  onOpen={openProjectLanding}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
