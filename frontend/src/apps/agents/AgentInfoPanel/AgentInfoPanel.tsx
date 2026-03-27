import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Text, Badge, Button, Modal } from "@cypher-asi/zui";
import { Bot, Loader2, Calendar, Monitor, Cloud } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { EntityCard } from "../../../components/EntityCard";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { SidekickActions } from "../../../components/SidekickActions";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
import { api, ApiClientError } from "../../../api/client";
import { useSelectedAgent, useAgentStore } from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import styles from "./AgentInfoPanel.module.css";

export function AgentInfoPanel() {
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showEditor, setShowEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
  }, [selectedAgent?.agent_id]);

  const openDeleteConfirm = useCallback(() => {
    setDeleteError(null);
    setShowDeleteConfirm(true);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedAgent) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.agents.delete(selectedAgent.agent_id);
      setShowDeleteConfirm(false);
      setSelectedAgent(null);
      useAgentStore.getState().fetchAgents({ force: true });
      navigate("/agents");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDeleteError(err.body.error);
      } else {
        setDeleteError("Failed to delete agent.");
      }
    } finally {
      setDeleting(false);
    }
  }, [selectedAgent, setSelectedAgent, navigate]);

  if (!selectedAgent) {
    return (
      <EmptyState>Select an agent to see details</EmptyState>
    );
  }

  const a = selectedAgent;
  const imageUrl = a.icon && !iconFailed ? a.icon : undefined;
  const isOwnAgent = !!user?.network_user_id && user.network_user_id === a.user_id;

  return (
    <div className={styles.wrapper}>
      <div className={styles.cardSlot}>
        <EntityCard
          headerLabel="AGENT"
          headerStatus={a.created_at ? "ACTIVE" : undefined}
          image={imageUrl}
          fallbackIcon={<Bot size={48} />}
          name={a.name}
          subtitle={a.role}
          nameAction={
            !isOwnAgent ? (
              <FollowEditButton
                isOwner={false}
                targetProfileId={a.profile_id}
              />
            ) : undefined
          }
          footer="CYPHER-ASI // AURA"
        >
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className={styles.hidden}
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
              {a.machine_type === "remote" ? (
                <Cloud size={13} className={styles.metaIcon} />
              ) : (
                <Monitor size={13} className={styles.metaIcon} />
              )}
              <span className={styles.metaValue}>
                {a.machine_type === "remote" ? "Remote Machine" : "Local Machine"}
              </span>
            </div>
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
                {a.system_prompt}
              </Text>
            </div>
          )}

        </EntityCard>
      </div>

      {isOwnAgent && (
        <SidekickActions
          onEdit={() => setShowEditor(true)}
          onDelete={openDeleteConfirm}
        />
      )}

      <AgentEditorModal
        isOpen={showEditor}
        agent={selectedAgent ?? undefined}
        onClose={() => setShowEditor(false)}
        onSaved={(updated) => {
          useAgentStore.getState().patchAgent(updated);
          useProjectsListStore.getState().patchAgentTemplateFields(updated);
          setSelectedAgent(updated.agent_id);
          useAgentStore.getState().fetchAgents({ force: true });
        }}
      />

      <Modal
        isOpen={showDeleteConfirm}
        onClose={closeDeleteConfirm}
        title="Delete Agent"
        size="sm"
        footer={
          <div className={styles.deleteFooter}>
            <Button variant="ghost" onClick={closeDeleteConfirm} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 size={14} className={styles.spin} /> Deleting...</> : "Delete"}
            </Button>
          </div>
        }
      >
        <Text size="sm">
          Are you sure you want to delete <strong>{a.name}</strong>? This cannot be undone.
        </Text>
        {deleteError && (
          <Text size="xs" className={styles.deleteError}>
            {deleteError}
          </Text>
        )}
      </Modal>
    </div>
  );
}
