import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client";
import type { Agent, OrgIntegration } from "../../types";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getAgentNameValidationMessage } from "../../lib/agentNameValidation";
import {
  runtimeAuthProvidersForAdapter,
  supportsLocalCliAuth,
  supportsOrgIntegrationAuth,
} from "../../lib/integrationCatalog";
import { useOrgStore } from "../../stores/org-store";
import {
  DEFAULT_LISTING_STATUS,
  listingStatusFromTags,
  mergeListingStatusTag,
  type AgentListingStatus,
} from "../../apps/marketplace/listing-status";
import { expertiseSlugsFromTags } from "../../apps/marketplace/marketplace-expertise";

export type HostMode = "local" | "cloud";

/// Tag string that marks a super-agent as harness-hosted ("cloud"). Mirrors
/// `HARNESS_HOST_TAG` in aura-os-server so the UI and server agree on the
/// wire format for the Phase 4 Local/Cloud toggle.
export const HOST_MODE_HARNESS_TAG = "host_mode:harness";

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
  showAdvancedRuntime: boolean;
  setShowAdvancedRuntime: (v: boolean) => void;
  integrationId: string;
  setIntegrationId: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  /**
   * Optional local-only folder override for this agent template. Takes
   * precedence over the project's `local_workspace_path`. Empty string means
   * "inherit from project / use default".
   */
  localWorkspacePath: string;
  setLocalWorkspacePath: (v: string) => void;
  hostMode: HostMode;
  setHostMode: (v: HostMode) => void;
  listingStatus: AgentListingStatus;
  setListingStatus: (v: AgentListingStatus) => void;
  simplifyForMobileCreate: boolean;
  restrictCreateToAuraRuntimes: boolean;
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

function defaultEnvironmentForLayout(isMobileLayout: boolean): string {
  return isMobileLayout ? "swarm_microvm" : "local_host";
}

function isDefaultCreateRuntime(
  adapterType: string,
  environment: string,
  authSource: string,
  integrationId: string,
  defaultModel: string,
  isMobileLayout: boolean,
): boolean {
  return (
    adapterType === "aura_harness" &&
    environment === defaultEnvironmentForLayout(isMobileLayout) &&
    authSource === "aura_managed" &&
    !integrationId.trim() &&
    !defaultModel.trim()
  );
}

export function useAgentEditorForm(
  isOpen: boolean,
  agent: Agent | undefined,
  onClose: () => void,
  onSaved: (agent: Agent) => void,
  closeOnSave = true,
): AgentEditorFormResult {
  const { isMobileLayout } = useAuraCapabilities();
  const simplifyForMobileCreate = isMobileLayout && !agent;
  const restrictCreateToAuraRuntimes = !agent;
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [icon, setIcon] = useState("");
  const [adapterType, setAdapterType] = useState("aura_harness");
  const [environment, setEnvironment] = useState(defaultEnvironmentForLayout(isMobileLayout));
  const [authSource, setAuthSource] = useState("aura_managed");
  const [showAdvancedRuntime, setShowAdvancedRuntime] = useState(false);
  const [integrationId, setIntegrationId] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [initialLocalWorkspacePath, setInitialLocalWorkspacePath] = useState("");
  // Local vs Cloud host mode for super-agents. Brand-new agents default to
  // "local" (in-process super-agent path). Existing agents load from their
  // tag set so toggling the UI round-trips through `host_mode:harness`.
  const [hostMode, setHostMode] = useState<HostMode>("local");
  const [listingStatus, setListingStatus] = useState<AgentListingStatus>(DEFAULT_LISTING_STATUS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState("");
  const rememberedIntegrationIdsRef = useRef<Record<string, string>>({});
  const { inputRef: nameRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeOrg, integrations } = useOrgStore(
    useShallow((s) => ({
      activeOrg: s.activeOrg,
      integrations: s.integrations,
    })),
  );
  const refreshIntegrations = useOrgStore((s) => s.refreshIntegrations);

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
      setLocalWorkspacePath(agent.local_workspace_path ?? "");
      setInitialLocalWorkspacePath(agent.local_workspace_path ?? "");
      setHostMode(
        agent.tags?.some((t) => t.toLowerCase() === HOST_MODE_HARNESS_TAG)
          ? "cloud"
          : "local",
      );
      setListingStatus(listingStatusFromTags(agent.tags));
      setShowAdvancedRuntime(
        !isDefaultCreateRuntime(
          agent.adapter_type ?? "aura_harness",
          agent.environment ?? (agent.machine_type === "remote" ? "swarm_microvm" : "local_host"),
          agent.auth_source ?? defaultAuthSource(agent.adapter_type ?? "aura_harness", agent.integration_id),
          agent.integration_id ?? "",
          agent.default_model ?? "",
          isMobileLayout,
        ),
      );
    } else {
      setName(""); setRole(""); setPersonality(""); setSystemPrompt(""); setIcon("");
      setAdapterType("aura_harness");
      setEnvironment(isMobileLayout ? "swarm_microvm" : "local_host");
      setAuthSource("aura_managed");
      setShowAdvancedRuntime(false);
      setIntegrationId("");
      setDefaultModel("");
      setLocalWorkspacePath("");
      setInitialLocalWorkspacePath("");
      setHostMode("local");
      setListingStatus(DEFAULT_LISTING_STATUS);
    }
    setError(""); setNameError("");
  }, [isOpen, agent, isMobileLayout]);

  useEffect(() => {
    if (!restrictCreateToAuraRuntimes) {
      return;
    }

    if (adapterType !== "aura_harness") {
      setAdapterType("aura_harness");
    }

    if (authSource !== "aura_managed") {
      setAuthSource("aura_managed");
    }

    if (integrationId) {
      setIntegrationId("");
    }

    if (defaultModel) {
      setDefaultModel("");
    }

    if (environment !== "local_host" && environment !== "swarm_microvm") {
      setEnvironment(defaultEnvironmentForLayout(isMobileLayout));
    }
  }, [
    adapterType,
    authSource,
    defaultModel,
    environment,
    integrationId,
    isMobileLayout,
    restrictCreateToAuraRuntimes,
  ]);

  useEffect(() => {
    if (
      !showAdvancedRuntime &&
      !isDefaultCreateRuntime(
        adapterType,
        environment,
        authSource,
        integrationId,
        defaultModel,
        isMobileLayout,
      )
    ) {
      setShowAdvancedRuntime(true);
    }
  }, [
    adapterType,
    authSource,
    defaultModel,
    environment,
    integrationId,
    isMobileLayout,
    showAdvancedRuntime,
  ]);

  useEffect(() => {
    if (!isOpen || !activeOrg?.org_id || integrations.length > 0) {
      return;
    }
    void refreshIntegrations();
  }, [activeOrg?.org_id, integrations.length, isOpen, refreshIntegrations]);

  useEffect(() => {
    if (restrictCreateToAuraRuntimes) {
      return;
    }

    const allowedAuthSources = adapterType === "aura_harness"
      ? ["aura_managed", "org_integration"]
      : [
          ...(supportsLocalCliAuth(adapterType) ? ["local_cli_auth"] : []),
          ...(supportsOrgIntegrationAuth(adapterType) ? ["org_integration"] : []),
        ];

    if (adapterType !== "aura_harness") {
      setEnvironment("local_host");
    }

    if (!allowedAuthSources.includes(authSource)) {
      setAuthSource(allowedAuthSources[0]);
    }
  }, [adapterType, authSource, restrictCreateToAuraRuntimes]);

  useEffect(() => {
    if (!restrictCreateToAuraRuntimes && authSource === "org_integration" && integrationId) {
      rememberedIntegrationIdsRef.current[adapterType] = integrationId;
    }
  }, [adapterType, authSource, integrationId, restrictCreateToAuraRuntimes]);

  useEffect(() => {
    if (restrictCreateToAuraRuntimes || authSource !== "org_integration") {
      return;
    }

    const requiredProviders = new Set(runtimeAuthProvidersForAdapter(adapterType));
    const selected = integrations.find((integration) => integration.integration_id === integrationId);
    if (!selected || !requiredProviders.has(selected.provider)) {
      const remembered = rememberedIntegrationIdsRef.current[adapterType];
      const fallback = integrations.find((integration) => (
        integration.integration_id === remembered && requiredProviders.has(integration.provider)
      )) ?? integrations.find((integration) => requiredProviders.has(integration.provider));
      setIntegrationId(fallback?.integration_id ?? "");
    }
  }, [adapterType, authSource, integrationId, integrations, restrictCreateToAuraRuntimes]);

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
    const validationMessage = getAgentNameValidationMessage(name, agent?.name);
    if (validationMessage) {
      setNameError(validationMessage);
      return;
    }

    setNameError(""); setSaving(true); setError("");
    try {
      const isSuperAgent = agent?.role === "super_agent" || agent?.tags?.includes("super_agent");
      const trimmedName = name.trim();
      const machineType = adapterType === "aura_harness"
        ? environment === "swarm_microvm" ? "remote" : "local"
        : "local";
      // Only super-agents are affected by the host-mode toggle today; the
      // toggle is hidden for regular agents, but we still strip any stale
      // `host_mode:harness` tag they may have inherited so they can't be
      // silently migrated. Other tags are preserved verbatim.
      const tagsAfterHostMode = isSuperAgent
        ? mergeHostModeTag(agent?.tags, hostMode)
        : agent?.tags;
      // Persist the marketplace listing status as an `expertise:`-style tag
      // until Phase 3 adds a real `listing_status` column on the network
      // agent record. `mergeListingStatusTag` strips any prior listing
      // tags before reapplying the current choice.
      const shouldPatchTags = isSuperAgent || listingStatus !== DEFAULT_LISTING_STATUS ||
        (agent?.tags?.some((t) => t.toLowerCase().startsWith("listing_status:")) ?? false);
      const tagsPayload = shouldPatchTags
        ? mergeListingStatusTag(tagsAfterHostMode, listingStatus)
        : undefined;
      // Send `listing_status` and `expertise` as first-class fields so the
      // server validates them against the canonical slug list (Phase 2). The
      // legacy `tags` encoding remains for backwards compatibility until
      // Phase 3 promotes both fields to dedicated network columns.
      const expertiseSlugs = expertiseSlugsFromTags(agent?.tags);
      // `local_workspace_path` is local-only and uses patch semantics: for
      // update we only include it when it actually changed (including
      // clearing it via `null`); for create we only include it when set.
      const trimmedLocalPath = localWorkspacePath.trim();
      const localPathChanged =
        trimmedLocalPath !== (initialLocalWorkspacePath ?? "").trim();
      const localWorkspacePatch: { local_workspace_path?: string | null } = agent
        ? localPathChanged
          ? { local_workspace_path: trimmedLocalPath ? trimmedLocalPath : null }
          : {}
        : trimmedLocalPath
          ? { local_workspace_path: trimmedLocalPath }
          : {};
      const payload = {
        org_id: agent?.org_id ?? activeOrg?.org_id,
        name: trimmedName, role: isSuperAgent ? "super_agent" : role.trim(),
        personality: personality.trim(), system_prompt: systemPrompt.trim(),
        icon: icon || (agent?.icon ? null : undefined),
        machine_type: !agent && isMobileLayout && adapterType === "aura_harness" ? "remote" : machineType,
        adapter_type: adapterType,
        environment,
        auth_source: authSource,
        integration_id: authSource === "org_integration" ? (integrationId || null) : null,
        default_model: defaultModel.trim() || null,
        ...(tagsPayload !== undefined ? { tags: tagsPayload } : {}),
        listing_status: listingStatus,
        ...(expertiseSlugs.length > 0 ? { expertise: expertiseSlugs } : {}),
        ...localWorkspacePatch,
      };
      const saved = agent
        ? await api.agents.update(agent.agent_id, payload)
        : await api.agents.create({ ...payload, icon: payload.icon ?? "" });
      onSaved(saved);
      if (closeOnSave) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally { setSaving(false); }
  }, [name, role, personality, systemPrompt, icon, adapterType, environment, authSource, integrationId, defaultModel, localWorkspacePath, initialLocalWorkspacePath, hostMode, listingStatus, agent, activeOrg?.org_id, isMobileLayout, onSaved, closeOnSave, onClose]);

  const isSuperAgent = agent?.role === "super_agent" || agent?.tags?.includes("super_agent") || false;

  return {
    name, setName, role, setRole, isSuperAgent, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon, setIcon,
    adapterType, setAdapterType, environment, setEnvironment,
    authSource, setAuthSource, showAdvancedRuntime, setShowAdvancedRuntime,
    integrationId, setIntegrationId, defaultModel, setDefaultModel,
    localWorkspacePath, setLocalWorkspacePath,
    hostMode, setHostMode,
    listingStatus, setListingStatus,
    simplifyForMobileCreate, restrictCreateToAuraRuntimes,
    availableIntegrations: integrations,
    saving, error, nameError, setNameError,
    nameRef, initialFocusRef, fileInputRef,
    cropOpen, rawImageSrc,
    handleSave, handleClose, handleFileSelect, handleCropConfirm, handleCropClose,
    handleAvatarClick, handleAvatarRemove, handleChangeImage,
  };
}

/// Produce the tag vector to send on save given an existing agent's tags and
/// a selected host mode. Returns a new array; never mutates the input. Any
/// non-host-mode tags (e.g. `super_agent`, future feature flags) are
/// preserved verbatim; only the `host_mode:*` entries are rewritten.
export function mergeHostModeTag(
  existing: readonly string[] | undefined,
  hostMode: HostMode,
): string[] {
  const kept = (existing ?? []).filter(
    (t) => !t.toLowerCase().startsWith("host_mode:"),
  );
  if (hostMode === "cloud") {
    kept.push(HOST_MODE_HARNESS_TAG);
  }
  return kept;
}
