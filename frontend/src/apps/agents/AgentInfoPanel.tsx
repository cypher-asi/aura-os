import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Badge, Button, Modal } from "@cypher-asi/zui";
import { Bot, Loader2, Calendar } from "lucide-react";
import { EntityCard } from "../../components/EntityCard";
import { FollowEditButton } from "../../components/FollowEditButton";
import { SidekickActions } from "../../components/SidekickActions";
import { AgentEditorModal } from "../../components/AgentEditorModal";
import { api } from "../../api/client";
import { useAgentApp } from "./AgentAppProvider";
import { useAuth } from "../../context/AuthContext";
import styles from "./AgentInfoPanel.module.css";

export function AgentInfoPanel() {
  const { selectedAgent, selectAgent, refresh } = useAgentApp();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showEditor, setShowEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
  }, [selectedAgent?.agent_id]);

  const handleDelete = useCallback(async () => {
    if (!selectedAgent) return;
    setDeleting(true);
    try {
      await api.agents.delete(selectedAgent.agent_id);
      setShowDeleteConfirm(false);
      selectAgent(null);
      refresh();
      navigate("/agents");
    } catch (err) {
      console.error("Failed to delete agent", err);
    } finally {
      setDeleting(false);
    }
  }, [selectedAgent, selectAgent, refresh, navigate]);

  if (!selectedAgent) {
    return (
      <div className={styles.empty}>
        <Text variant="muted" size="sm">Select an agent to see details</Text>
      </div>
    );
  }

  const a = selectedAgent;
  const imageUrl = a.icon && !iconFailed ? a.icon : undefined;
  const isOwnAgent = user?.user_id === a.user_id;

  return (
    <div className={styles.wrapper}>
      <EntityCard
        headerLabel="AGENT"
        headerStatus={a.created_at ? "ACTIVE" : undefined}
        image={imageUrl}
        fallbackIcon={<Bot size={48} />}
        name={a.name}
        subtitle={a.role}
        nameAction={
          <FollowEditButton
            isOwner={isOwnAgent}
            targetType="agent"
            targetName={a.name}
            onEdit={() => setShowEditor(true)}
          />
        }
        footer="CYPHER-ASI // AURA"
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            style={{ display: "none" }}
            onError={() => setIconFailed(true)}
          />
        )}

        {a.personality && (
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Personality</Text>
            <Text size="sm">{a.personality}</Text>
          </div>
        )}

        <div className={styles.metaGrid}>
          <div className={styles.metaRow}>
            <Calendar size={13} className={styles.metaIcon} />
            <span className={styles.metaValue}>
              Birthed {new Date(a.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
        </div>

        {a.skills.length > 0 && (
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Skills</Text>
            <div className={styles.skills}>
              {a.skills.map((s) => (
                <Badge key={s} variant="pending" className={styles.skillBadge}>{s}</Badge>
              ))}
            </div>
          </div>
        )}

        {a.system_prompt && (
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">System Prompt</Text>
            <Text size="sm" className={styles.prompt}>
              {a.system_prompt.slice(0, 300)}{a.system_prompt.length > 300 ? "…" : ""}
            </Text>
          </div>
        )}

      </EntityCard>

      {isOwnAgent && (
        <SidekickActions
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      <AgentEditorModal
        isOpen={showEditor}
        agent={selectedAgent}
        onClose={() => setShowEditor(false)}
        onSaved={(updated) => {
          selectAgent(updated);
          refresh();
        }}
      />

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Agent"
        size="sm"
        footer={
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 size={14} className={styles.spin} /> Deleting...</> : "Delete"}
            </Button>
          </div>
        }
      >
        <Text size="sm">
          Are you sure you want to delete <strong>{a.name}</strong>? This cannot be undone.
        </Text>
      </Modal>
    </div>
  );
}
