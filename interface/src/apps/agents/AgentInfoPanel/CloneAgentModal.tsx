import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import { Cloud, Loader2, Monitor } from "lucide-react";

import { api } from "../../../api/client";
import type { CloneAgentMachineType } from "../../../shared/api/agents";
import { getApiErrorMessage } from "../../../shared/utils/api-errors";
import type { Agent } from "../../../shared/types";
import styles from "./CloneAgentModal.module.css";

const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

function defaultCloneName(sourceName: string): string {
  const base = sourceName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
  return `${base}-copy`;
}

function initialMachineType(
  sourceMachineType: string,
  localAgentRuntimeAvailable: boolean,
): CloneAgentMachineType {
  return sourceMachineType === "local" && localAgentRuntimeAvailable
    ? "local"
    : "remote";
}

export function CloneAgentModal({
  isOpen,
  sourceAgent,
  localAgentRuntimeAvailable,
  onClose,
  onCloned,
}: {
  isOpen: boolean;
  sourceAgent: Agent;
  localAgentRuntimeAvailable: boolean;
  onClose: () => void;
  onCloned: (agent: Agent) => void;
}) {
  const [name, setName] = useState(() => defaultCloneName(sourceAgent.name));
  const [machineType, setMachineType] = useState<CloneAgentMachineType>(() =>
    initialMachineType(sourceAgent.machine_type, localAgentRuntimeAvailable));
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [cloning, setCloning] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(defaultCloneName(sourceAgent.name));
    setMachineType(initialMachineType(sourceAgent.machine_type, localAgentRuntimeAvailable));
    setNameError("");
    setError("");
    setCloning(false);
  }, [
    isOpen,
    localAgentRuntimeAvailable,
    sourceAgent.agent_id,
    sourceAgent.machine_type,
    sourceAgent.name,
  ]);

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
      const result = await api.agents.clone(sourceAgent.agent_id, {
        name: trimmedName,
        machine_type: machineType,
      });
      onCloned(result.agent);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setCloning(false);
    }
  }, [machineType, name, onClose, onCloned, sourceAgent.agent_id]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Clone Agent"
      size="sm"
      initialFocusRef={nameRef as React.RefObject<HTMLElement>}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={cloning}>Cancel</Button>
          <Button variant="primary" onClick={handleClone} disabled={cloning}>
            {cloning ? <><Loader2 size={14} /> Cloning...</> : "Clone Agent"}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <Text size="sm">
          Create a separate copy of <strong>{sourceAgent.name}</strong>. The original
          agent stays unchanged.
        </Text>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="clone-agent-name">Agent name</label>
          <Input
            id="clone-agent-name"
            ref={nameRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError("");
            }}
            validationMessage={nameError}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label} id="clone-agent-machine-type">Runs on</span>
          <div
            className={styles.machineGrid}
            role="radiogroup"
            aria-labelledby="clone-agent-machine-type"
          >
            <button
              type="button"
              role="radio"
              aria-checked={machineType === "local"}
              className={`${styles.machineOption} ${machineType === "local" ? styles.machineOptionActive : ""}`}
              onClick={() => setMachineType("local")}
              disabled={!localAgentRuntimeAvailable || cloning}
            >
              <span className={styles.machineTitle}><Monitor size={15} />Web Local</span>
              <span className={styles.machineDescription}>
                {localAgentRuntimeAvailable
                  ? "Runs on this device with access to its local tools."
                  : "Unavailable in this runtime."}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={machineType === "remote"}
              className={`${styles.machineOption} ${machineType === "remote" ? styles.machineOptionActive : ""}`}
              onClick={() => setMachineType("remote")}
              disabled={cloning}
            >
              <span className={styles.machineTitle}><Cloud size={15} />Remote</span>
              <span className={styles.machineDescription}>
                Runs in an Aura-managed isolated runtime.
              </span>
            </button>
          </div>
        </div>

        <Text size="xs" variant="muted">
          Copies profile, prompt, model, permissions, and skill labels. The clone gets a
          new identity and wallet. Chats, memory, workspace files, installed skill packages,
          secrets, and processes stay with the original agent.
        </Text>
        {error && (
          <Text size="xs" role="alert" className={styles.error}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
