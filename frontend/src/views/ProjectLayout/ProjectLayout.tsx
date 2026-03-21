import { Loader2 } from "lucide-react";
import { Outlet } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { EmptyState } from "../../components/EmptyState";
import { Button } from "@cypher-asi/zui";
import { ArrowLeft } from "lucide-react";
import { useProjectLayoutData } from "./useProjectLayoutData";
import styles from "./ProjectLayout.module.css";

export function ProjectLayout() {
  const navigate = useNavigate();
  const { displayProject, loading, projects } = useProjectLayoutData();

  if (loading && !displayProject) {
    return (
      <EmptyState>
        <Loader2 size={20} className="spin" />
      </EmptyState>
    );
  }
  if (!displayProject) {
    if (projects.length === 0) {
      return (
        <EmptyState>
          <div className={styles.centeredColumn}>
            <strong>No project selected</strong>
            <span>Create a project to get started.</span>
          </div>
        </EmptyState>
      );
    }

    return (
      <EmptyState>
        <div className={styles.centeredColumn}>
          <strong>Project not found</strong>
          <span>Choose a project from navigation to continue.</span>
          <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate("/projects")}>
            Back to Projects
          </Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <ErrorBoundary name="project-view">
      <Outlet />
    </ErrorBoundary>
  );
}
