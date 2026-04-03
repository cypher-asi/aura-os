import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client";
import type { Agent, OrgIntegration } from "../../types";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";

interface AgentEditorFormResult {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  isSuperAgent: boolean;
  personality: string;
  setPersonality: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
  adapterType: string;
  setAdapterType: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
  authSource: string;
  setAuthSource: (v: string) => void;
  integrationId: string;
  setIntegrationId: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  availableIntegrations: OrgIntegration[];
  saving: boolean;
  error: string;
  nameError: string;
  setNameError: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  initialFocusRef: React.RefObject<HTMLElement> | undefined;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cropOpen: boolean;
  rawImageSrc: string;
  handleSave: () => Promise<void>;
  handleClose: () => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCropConfirm: (dataUrl: string) => void;
  handleCropClose: () => void;
  handleAvatarClick: () => void;
  handleAvatarRemove: () => void;
  handleChangeImage: () => void;
}

function defaultAuthSource(adapterType: string, integrationId?: string | null): string {
  if (integrationId?.trim()) return "org_integration";
  if (adapterType === "aura_harness") return "aura_managed";
  return "local_cli_auth";
}

function requiredProviderForAdapter(adapterType: string): string | null {
  if (adapterType === "claude_code") return "anthropic";
  if (adapterType === "codex") return "openai";
  return null;
}

export function useAgentEditorForm(
  isOpen: boolean,
  agent: Agent | undefined,
  onClose: () => void,
  onSaved: (agent: Agent) => void,
): AgentEditorFormResult {
  const { isMobileLayout } = useAuraCapabilities();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [icon, setIcon] = useState("");
  const [adapterType, setAdapterType] = useState("aura_harness");
  const [environment, setEnvironment] = useState("swarm_microvm");
  const [authSource, setAuthSource] = useState("aura_managed");
  const [integrationId, setIntegrationId] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState("");
  const { inputRef: nameRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeOrg, integrations } = useOrgStore(
    useShallow((s) => ({
      activeOrg: s.activeOrg,
      integrations: s.integrations,
    })),
  );

  useEffect(() => {
    if (!isOpen) return;
    if (agent) {
      const isSuperRole = agent.role === "super_agent" || agent.tags?.includes("super_agent");
      setName(agent.name); setRole(isSuperRole ? "" : agent.role);
      setPersonality(agent.personality); setSystemPrompt(agent.system_prompt);
      setIcon(agent.icon ?? "");
      setAdapterType(agent.adapter_type ?? "aura_harness");
      setEnvironment(agent.environment ?? (agent.machine_type === "remote" ? "swarm_microvm" : "local_host"));
      setAuthSource(agent.auth_source ?? defaultAuthSource(agent.adapter_type ?? "aura_harness", agent.integration_id));
      setIntegrationId(agent.integration_id ?? "");
      setDefaultModel(agent.default_model ?? "");
    } else {
      setName(""); setRole(""); setPersonality(""); setSystemPrompt(""); setIcon("");
      setAdapterType("aura_harness");
      setEnvironment(isMobileLayout ? "swarm_microvm" : "local_host");
      setAuthSource("aura_managed");
      setIntegrationId("");
      setDefaultModel("");
    }
    setError(""); setNameError("");
  }, [isOpen, agent, isMobileLayout]);

  useEffect(() => {
    if (adapterType === "aura_harness") {
      setAuthSource("aura_managed");
      return;
    }
    setEnvironment("local_host");
    if (authSource === "aura_managed") {
      setAuthSource("local_cli_auth");
    }
  }, [adapterType, authSource]);

  useEffect(() => {
    if (adapterType === "aura_harness") {
      if (integrationId) setIntegrationId("");
      return;
    }

    if (authSource !== "org_integration") {
      if (integrationId) setIntegrationId("");
      return;
    }

    const requiredProvider = requiredProviderForAdapter(adapterType);
    const selected = integrations.find((integration) => integration.integration_id === integrationId);
    if (!selected || selected.provider !== requiredProvider) {
      const fallback = integrations.find((integration) => integration.provider === requiredProvider);
      setIntegrationId(fallback?.integration_id ?? "");
    }
  }, [adapterType, authSource, integrationId, integrations]);

  const handleClose = useCallback(() => {
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
    setError(""); setNameError(""); setSaving(false); onClose();
  }, [rawImageSrc, onClose]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    const objectUrl = URL.createObjectURL(file);
    setRawImageSrc(objectUrl);
    setCropOpen(true);
    e.target.value = "";
  }, [rawImageSrc]);

  const handleCropConfirm = useCallback((dataUrl: string) => {
    setIcon(dataUrl);
    setCropOpen(false);
  }, []);

  const handleCropClose = useCallback(() => {
    setCropOpen(false);
  }, []);

  const handleAvatarClick = useCallback(() => {
    if (rawImageSrc) {
      setCropOpen(true);
    } else if (icon) {
      setRawImageSrc(icon);
      setCropOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }, [rawImageSrc, icon]);

  const handleAvatarRemove = useCallback(() => {
    setIcon("");
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
  }, [rawImageSrc]);

  const handleChangeImage = useCallback(() => {
    setCropOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setNameError("Name is required"); return; }
    setNameError(""); setSaving(true); setError("");
    try {
      const isSuperAgent = agent?.role === "super_agent" || agent?.tags?.includes("super_agent");
      const machineType = adapterType === "aura_harness"
        ? environment === "swarm_microvm" ? "remote" : "local"
        : "local";
      const payload = {
        org_id: agent?.org_id ?? activeOrg?.org_id,
        name: name.trim(), role: isSuperAgent ? "super_agent" : role.trim(),
        personality: personality.trim(), system_prompt: systemPrompt.trim(),
        icon: icon || (agent?.icon ? null : undefined),
        machine_type: !agent && isMobileLayout && adapterType === "aura_harness" ? "remote" : machineType,
        adapter_type: adapterType,
        environment,
        auth_source: authSource,
        integration_id: authSource === "org_integration" ? (integrationId || null) : null,
        default_model: defaultModel.trim() || null,
      };
      const saved = agent
        ? await api.agents.update(agent.agent_id, payload)
        : await api.agents.create({ ...payload, icon: payload.icon ?? "" });
      onSaved(saved); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally { setSaving(false); }
  }, [name, role, personality, systemPrompt, icon, adapterType, environment, authSource, integrationId, defaultModel, agent, activeOrg?.org_id, isMobileLayout, onSaved, onClose]);

  const isSuperAgent = agent?.role === "super_agent" || agent?.tags?.includes("super_agent") || false;

  return {
    name, setName, role, setRole, isSuperAgent, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon, setIcon,
    adapterType, setAdapterType, environment, setEnvironment,
    authSource, setAuthSource,
    integrationId, setIntegrationId, defaultModel, setDefaultModel,
    availableIntegrations: integrations,
    saving, error, nameError, setNameError,
    nameRef, initialFocusRef, fileInputRef,
    cropOpen, rawImageSrc,
    handleSave, handleClose, handleFileSelect, handleCropConfirm, handleCropClose,
    handleAvatarClick, handleAvatarRemove, handleChangeImage,
  };
}
