import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@cypher-asi/zui";
import { useLocation, useNavigate } from "react-router-dom";
import { SendHorizontal } from "lucide-react";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { filterRuntimeVisibleAgents } from "../../shared/lib/agent-runtime-visibility";
import { useQuickPromptStore } from "../../stores/quick-prompt-store";
import styles from "./QuickPromptModal.module.css";

function agentIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/agents\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function QuickPromptModal(): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const { remoteOnly } = useAuraCapabilities();
  const agents = useAgentStore((state) => state.agents);
  const agentsStatus = useAgentStore((state) => state.agentsStatus);
  const isOpen = useQuickPromptStore((state) => state.isOpen);
  const preferredAgentId = useQuickPromptStore((state) => state.preferredAgentId);
  const close = useQuickPromptStore((state) => state.close);
  const queue = useQuickPromptStore((state) => state.queue);
  const visibleAgents = useMemo(
    () => filterRuntimeVisibleAgents(agents, remoteOnly),
    [agents, remoteOnly],
  );
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (agentsStatus === "idle") {
      void useAgentStore.getState().fetchAgents();
    }
  }, [agentsStatus, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const pathAgentId = agentIdFromPath(location.pathname);
    const preferred = preferredAgentId ?? pathAgentId;
    const nextAgent = visibleAgents.find((agent) => agent.agent_id === preferred)
      ?? visibleAgents[0];
    setAgentId(nextAgent?.agent_id ?? "");
    setPrompt("");
  }, [isOpen, location.pathname, preferredAgentId, visibleAgents]);

  if (!isOpen) return null;

  const submit = () => {
    const trimmed = prompt.trim();
    if (!agentId || !trimmed) return;
    queue(agentId, trimmed);
    navigate(`/agents/${encodeURIComponent(agentId)}`);
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title="Quick Prompt"
      size="md"
      footer={
        <div className={styles.footer}>
          <span className={styles.hint}>⌘/Ctrl + Enter to continue</span>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!agentId || !prompt.trim()}
          >
            <SendHorizontal size={14} aria-hidden="true" />
            Open in chat
          </Button>
        </div>
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className={styles.label} htmlFor="quick-prompt-agent">
          Agent
        </label>
        <select
          id="quick-prompt-agent"
          className={styles.select}
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
          disabled={visibleAgents.length === 0}
        >
          {visibleAgents.length === 0 ? (
            <option value="">No available agents</option>
          ) : null}
          {visibleAgents.map((agent) => (
            <option key={agent.agent_id} value={agent.agent_id}>
              {agent.name}
            </option>
          ))}
        </select>
        <label className={styles.label} htmlFor="quick-prompt-text">
          What do you want to work on?
        </label>
        <textarea
          id="quick-prompt-text"
          className={styles.textarea}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Capture the thought now; refine it in chat…"
          rows={7}
          autoFocus
        />
        <p className={styles.note}>
          The prompt is placed in the composer for review. Nothing is sent automatically.
        </p>
      </form>
    </Modal>
  );
}
