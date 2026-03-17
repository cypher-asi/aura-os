import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { api } from "../api/client";
import { useOrg } from "../context/OrgContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { getLastAgent } from "../utils/storage";
import type { Project } from "../types";
import styles from "./HomeView.module.css";

function MobileProjectsHome() {
  const navigate = useNavigate();
  const { activeOrg } = useOrg();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    api.listProjects(activeOrg?.org_id)
      .then((items) => {
        if (!cancelled) {
          setProjects(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrg?.org_id]);

  const recentProjects = useMemo(
    () => [...projects]
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, 3),
    [projects],
  );

  return (
    <div className={styles.mobileHome}>
      <section className={styles.heroCard}>
        <div className={styles.heroIconWrap}>
          <Rocket size={20} />
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.heroEyebrow}>Projects</p>
          <h1 className={styles.heroTitle}>Pick up work without hunting through the app.</h1>
          <p className={styles.heroDescription}>
            Open the menu to switch projects, or jump straight back into something recent below.
          </p>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.statPill}>
            <span className={styles.statLabel}>Team</span>
            <span className={styles.statValue}>{activeOrg?.name ?? "Personal"}</span>
          </div>
          <div className={styles.statPill}>
            <span className={styles.statLabel}>Projects</span>
            <span className={styles.statValue}>{loading ? "..." : projects.length}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent projects</h2>
          <span className={styles.sectionHint}>Use the menu to create or browse all</span>
        </div>

        {loading ? (
          <div className={styles.loadingGrid}>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className={styles.projectCardSkeleton} />
            ))}
          </div>
        ) : recentProjects.length > 0 ? (
          <div className={styles.projectGrid}>
            {recentProjects.map((project) => (
              <button
                key={project.project_id}
                type="button"
                className={styles.projectCard}
                onClick={() => navigate(`/projects/${project.project_id}`)}
              >
                <span className={styles.projectCardStatus}>{project.current_status}</span>
                <span className={styles.projectCardTitle}>{project.name}</span>
                <span className={styles.projectCardMeta}>
                  Updated {new Date(project.updated_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyCard}>
            <p className={styles.emptyTitle}>No projects yet</p>
            <p className={styles.emptyDescription}>
              Create one from the project drawer or connect a linked desktop workspace to get started.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function HomeView() {
  const lastAgent = getLastAgent();
  const { isMobileLayout } = useAuraCapabilities();

  if (lastAgent) {
    return (
      <Navigate
        to={`/projects/${lastAgent.projectId}/agents/${lastAgent.agentInstanceId}`}
        replace
      />
    );
  }

  if (isMobileLayout) {
    return <MobileProjectsHome />;
  }

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description="Select a project from navigation or create a new one to get started."
    />
  );
}
