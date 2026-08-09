import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import { Loader2 } from "lucide-react";

import { api } from "../../../api/client";
import { getApiErrorMessage } from "../../../shared/utils/api-errors";
import type { Agent } from "../../../shared/types";

const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

function defaultLocalCloneName(sourceName: string): string {
  const base = sourceName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
  return `${base}-local`;
}

export function CloneAgentToLocalModal({
  isOpen,
  sourceAgent,
  onClose,
  onCloned,
}: {
  isOpen: boolean;
  sourceAgent: Agent;
  onClose: () => void;
  onCloned: (agent: Agent) => void;
}) {
  const [name, setName] = useState(() => defaultLocalCloneName(sourceAgent.name));
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [cloning, setCloning] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(defaultLocalCloneName(sourceAgent.name));
    setNameError("");
    setError("");
    setCloning(false);
  }, [isOpen, sourceAgent.agent_id, sourceAgent.name]);

  const handleClone = useCallback(async () => {
    const trimmedName = name.trim();
    setNameError("");
    setError("");
    if (!trimmedName) {
      setNameError("Name is required");
      nameRef.current?.focus();
      return;
    }
    if (!AGENT_NAME_RE.test(trimmedName)) {
      setNameError("Use only letters, numbers, hyphens, or underscores");
      nameRef.current?.focus();
      return;
    }

    setCloning(true);
    try {
      const result = await api.agents.cloneToLocal(sourceAgent.agent_id, {
        name: trimmedName,
      });
      onCloned(result.agent);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setCloning(false);
    }
  }, [name, onClose, onCloned, sourceAgent.agent_id]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Clone as Local"
      size="sm"
      initialFocusRef={nameRef as React.RefObject<HTMLElement>}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={cloning}>Cancel</Button>
          <Button variant="primary" onClick={handleClone} disabled={cloning}>
            {cloning ? <><Loader2 size={14} /> Cloning...</> : "Clone Agent"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Text size="sm">
          Create a separate local copy of <strong>{sourceAgent.name}</strong>. The remote
          agent stays online and unchanged.
        </Text>
        <div>
          <Text size="xs" weight="medium">Local agent name</Text>
          <Input
            ref={nameRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError("");
            }}
            validationMessage={nameError}
          />
        </div>
        <Text size="xs" variant="muted">
          Copies profile, prompt, model, permissions, and skill labels. The clone gets a
          new identity and wallet. Chats, memory, workspace files, installed skill packages,
          secrets, and processes stay with the remote agent.
        </Text>
        {error && (
          <Text size="xs" role="alert" style={{ color: "var(--color-danger)" }}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
