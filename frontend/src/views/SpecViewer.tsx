import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { api } from "../api/client";
import type { Spec } from "../types";
import { PageHeader, PageEmptyState, Panel, Breadcrumb, Spinner } from "@cypher-asi/zui";
import styles from "./aura.module.css";

export function SpecViewer() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const navigate = useNavigate();
  const [spec, setSpec] = useState<Spec | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !specId) return;
    api
      .getSpec(projectId, specId)
      .then(setSpec)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, specId]);

  if (loading) return <Spinner />;
  if (!spec) {
    return <PageEmptyState title="Spec not found" />;
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Specs", onClick: () => navigate(`/projects/${projectId}/specs`) },
          { label: `#${spec.order_index + 1} ${spec.title}` },
        ]}
      />
      <PageHeader title={spec.title} subtitle={`Spec #${spec.order_index + 1}`} />
      <Panel variant="solid" border="solid" borderRadius="md" style={{ padding: "var(--space-4)" }}>
        <div className={styles.markdown}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {spec.markdown_contents}
          </ReactMarkdown>
        </div>
      </Panel>
    </div>
  );
}
