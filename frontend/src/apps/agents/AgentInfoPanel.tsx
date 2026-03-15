import { useState, useCallback } from "react";
import { Text, Badge, Button, Input } from "@cypher-asi/zui";
import { Bot, Pencil, Save, X, Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { useAgentApp } from "./AgentAppProvider";
import styles from "./AgentInfoPanel.module.css";

export function AgentInfoPanel() {
  const { selectedAgent, selectAgent, refresh } = useAgentApp();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  const startEditing = useCallback(() => {
    if (!selectedAgent) return;
    setName(selectedAgent.name);
    setRole(selectedAgent.role);
    setPersonality(selectedAgent.personality);
    setSystemPrompt(selectedAgent.system_prompt);
    setEditing(true);
  }, [selectedAgent]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedAgent) return;
    setSaving(true);
    try {
      const updated = await api.agents.update(selectedAgent.agent_id, {
        name,
        role,
        personality,
        system_prompt: systemPrompt,
      });
      selectAgent(updated);
      refresh();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [selectedAgent, name, role, personality, systemPrompt, selectAgent, refresh]);

  if (!selectedAgent) {
    return (
      <div className={styles.empty}>
        <Text variant="muted" size="sm">Select an agent to see details</Text>
      </div>
    );
  }

  const a = selectedAgent;

  return (
    <div className={styles.container}>
      <div className={styles.panelHeader}>
        <div style={{ flex: 1 }} />
        {!editing && (
          <button className={styles.editButton} onClick={startEditing} title="Edit agent">
            <Pencil size={14} />
          </button>
        )}
      </div>

      <div className={styles.avatarLarge}>
        {a.icon ? (
          <img src={a.icon} alt="" className={styles.avatarImg} />
        ) : (
          <Bot size={48} />
        )}
      </div>

      {editing ? (
        <>
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Name</Text>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Role</Text>
            <Input value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Personality</Text>
            <textarea
              className={styles.editTextarea}
              rows={3}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
            />
          </div>
          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">System Prompt</Text>
            <textarea
              className={styles.editTextarea}
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
          <div className={styles.editActions}>
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={14} />}
              onClick={cancelEditing}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              icon={saving ? <Loader2 size={14} className={styles.spin} /> : <Save size={14} />}
              onClick={handleSave}
              disabled={saving}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <Text weight="semibold" size="lg" style={{ textAlign: "center" }}>{a.name}</Text>
          <Text variant="muted" size="sm" style={{ textAlign: "center" }}>{a.role}</Text>

          {a.personality && (
            <div className={styles.section}>
              <Text size="xs" variant="muted" weight="medium">Personality</Text>
              <Text size="sm">{a.personality}</Text>
            </div>
          )}

          <div className={styles.section}>
            <Text size="xs" variant="muted" weight="medium">Created</Text>
            <Text size="sm">{new Date(a.created_at).toLocaleDateString()}</Text>
          </div>

          {a.skills.length > 0 && (
            <div className={styles.section}>
              <Text size="xs" variant="muted" weight="medium">Skills</Text>
              <div className={styles.skills}>
                {a.skills.map((s) => <Badge key={s} variant="pending">{s}</Badge>)}
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
        </>
      )}
    </div>
  );
}
