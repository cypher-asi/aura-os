import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { Agent } from "../../types";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";

interface AgentEditorFormResult {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  personality: string;
  setPersonality: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
  machineType: string;
  setMachineType: (v: string) => void;
  saving: boolean;
  error: string;
  nameError: string;
  setNameError: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  initialFocusRef: React.RefObject<HTMLElement> | undefined;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleSave: () => Promise<void>;
  handleClose: () => void;
  handleImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useAgentEditorForm(
  isOpen: boolean,
  agent: Agent | undefined,
  onClose: () => void,
  onSaved: (agent: Agent) => void,
): AgentEditorFormResult {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [icon, setIcon] = useState("");
  const [machineType, setMachineType] = useState("local");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const { inputRef: nameRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (agent) {
      setName(agent.name); setRole(agent.role);
      setPersonality(agent.personality); setSystemPrompt(agent.system_prompt);
      setIcon(agent.icon ?? "");
      setMachineType(agent.machine_type ?? "local");
    } else {
      setName(""); setRole(""); setPersonality(""); setSystemPrompt(""); setIcon("");
      setMachineType("local");
    }
    setError(""); setNameError("");
  }, [isOpen, agent]);

  const handleClose = useCallback(() => {
    setError(""); setNameError(""); setSaving(false); onClose();
  }, [onClose]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(128 / img.width, 128 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
      setIcon(canvas.toDataURL("image/webp", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setNameError("Name is required"); return; }
    setNameError(""); setSaving(true); setError("");
    try {
      const payload = {
        name: name.trim(), role: role.trim(),
        personality: personality.trim(), system_prompt: systemPrompt.trim(),
        icon: icon || (agent?.icon ? null : undefined),
        machine_type: machineType,
      };
      const saved = agent
        ? await api.agents.update(agent.agent_id, payload)
        : await api.agents.create({ ...payload, icon: payload.icon ?? "" });
      onSaved(saved); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally { setSaving(false); }
  }, [name, role, personality, systemPrompt, icon, machineType, agent, onSaved, onClose]);

  return {
    name, setName, role, setRole, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon, setIcon, machineType, setMachineType,
    saving, error, nameError, setNameError,
    nameRef, initialFocusRef, fileInputRef,
    handleSave, handleClose, handleImageSelect,
  };
}
