import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@cypher-asi/zui";
import { useLocation, useNavigate } from "react-router-dom";
import { SendHorizontal } from "lucide-react";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { filterRuntimeVisibleAgents } from "../../shared/lib/agent-runtime-visibility";
import type { Agent } from "../../shared/types";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useQuickPromptStore } from "../../stores/quick-prompt-store";
import styles from "./QuickPromptModal.module.css";

function agentIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/agents\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function agentIdFromLocation(pathname: string, search: string): string | null {
  if (pathname === "/chat") {
    return new URLSearchParams(search).get("agent");
  }
  const standaloneId = agentIdFromPath(pathname);
  if (standaloneId) return standaloneId;

  const projectMatch = pathname.match(/^\/projects\/([^/]+)\/agents\/([^/]+)$/);
  if (!projectMatch) return null;
  const projectId = decodeURIComponent(projectMatch[1]);
  const instanceId = decodeURIComponent(projectMatch[2]);
  return useProjectsListStore
    .getState()
    .agentsByProject[projectId]
    ?.find((agent) => agent.agent_instance_id === instanceId)
    ?.agent_id ?? null;
}

function freshChatDestination(agentId: string): string {
  const params = new URLSearchParams({
    agent: agentId,
    fresh:
      globalThis.crypto?.randomUUID?.()
      ?? `quick-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  return `/chat?${params.toString()}`;
}

export function QuickPromptModal(): React.ReactElement | null {
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

  useEffect(() => {
    if (!isOpen) return;
    if (agentsStatus === "idle") {
      void useAgentStore.getState().fetchAgents();
    }
  }, [agentsStatus, isOpen]);

  if (!isOpen) return null;

  // Keeping the form in a child means closing the modal unmounts all draft
  // state. Reopening starts clean without effect-driven setState calls, while
  // a late agents fetch can still supply the preferred/fallback selection.
  return (
    <QuickPromptForm
      visibleAgents={visibleAgents}
      preferredAgentId={preferredAgentId}
      close={close}
      queue={queue}
    />
  );
}

interface QuickPromptFormProps {
  visibleAgents: Agent[];
  preferredAgentId: string | null;
  close: () => void;
  queue: (agentId: string, text: string) => void;
}

function QuickPromptForm({
  visibleAgents,
  preferredAgentId,
  close,
  queue,
}: QuickPromptFormProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const contextualAgentId = agentIdFromLocation(
    location.pathname,
    location.search,
  );
  const preferred = preferredAgentId ?? contextualAgentId;
  const initialAgentId =
    visibleAgents.find((agent) => agent.agent_id === preferred)?.agent_id
    ?? visibleAgents[0]?.agent_id
    ?? "";
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId);
  const [prompt, setPrompt] = useState("");
  const agentId = visibleAgents.some(
    (agent) => agent.agent_id === selectedAgentId,
  )
    ? selectedAgentId
    : visibleAgents.find((agent) => agent.agent_id === preferred)?.agent_id
      ?? visibleAgents[0]?.agent_id
      ?? "";

  const submit = () => {
    const trimmed = prompt.trim();
    if (!agentId || !trimmed) return;
    queue(agentId, trimmed);
    if (contextualAgentId === agentId) {
      navigate(`${location.pathname}${location.search}${location.hash}`);
      return;
    }
    navigate(freshChatDestination(agentId));
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
          onChange={(event) => setSelectedAgentId(event.target.value)}
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
