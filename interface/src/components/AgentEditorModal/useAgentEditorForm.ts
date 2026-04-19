import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client";
import type { Agent, AgentPermissions, OrgIntegration } from "../../types";
import { emptyAgentPermissions } from "../../types/permissions-wire";
import { isSuperAgent as isSuperAgentByPerms } from "../../types/permissions";
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
import {
  MARKETPLACE_EXPERTISE_SLUG_SET,
  expertiseSlugsFromTags,
} from "../../apps/marketplace/marketplace-expertise";

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

  const isSuperAgent = !!(agent && isSuperAgentByPerms(agent));

  useEffect(() => {
    if (!isOpen) return;
    if (agent) {
      setName(agent.name);
      setRole(isSuperAgentByPerms(agent) ? "" : agent.role);
      setPersonality(agent.personality); setSystemPrompt(agent.system_prompt);
      setIcon(agent.icon ?? "");
      setAdapterType(agent.adapter_type ?? "aura_harness");
      setEnvironment(agent.environment ?? (agent.machine_type === "remote" ? "swarm_microvm" : "local_host"));
      setAuthSource(agent.auth_source ?? defaultAuthSource(agent.adapter_type ?? "aura_harness", agent.integration_id));
      setIntegrationId(agent.integration_id ?? "");
      setDefaultModel(agent.default_model ?? "");
      setLocalWorkspacePath(agent.local_workspace_path ?? "");
      setInitialLocalWorkspacePath(agent.local_workspace_path ?? "");
      setListingStatus(agent.listing_status ?? listingStatusFromTags(agent.tags));
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
    // Adapter has no runtime-compatible providers in the catalog (e.g. legacy
    // `aura_harness` hosted agents pointing at an Anthropic org integration).
    // We must not clobber the operator's saved integration here just because
    // the current catalog no longer advertises a runtime route for it.
    if (requiredProviders.size === 0) {
      return;
    }
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
      const trimmedName = name.trim();
      const machineType = adapterType === "aura_harness"
        ? environment === "swarm_microvm" ? "remote" : "local"
        : "local";
      // `role` is a free-text display label. We preserve the existing role on
      // super-agents (so their chosen title stays) and never inject any system
      // tags (`host_mode:*`, `preset:*`, `migration:*`) on save. User-facing
      // tags like listing-status flow through unchanged below.
      const roleToSend = isSuperAgent ? (agent?.role ?? role.trim()) : role.trim();
      // Strip any legacy system tags that the old harness-mode / CEO-preset
      // migration flows used to inject (`host_mode:*`, `preset:*`,
      // `migration:*`). Those are no longer meaningful to the backend and the
      // interface must never re-emit them. User-facing tags (e.g.
      // `team:frontend`) and the legacy `super_agent` sentinel pass through
      // unchanged — `super_agent` has no system meaning now that detection is
      // permissions-based, but we preserve it verbatim rather than quietly
      // dropping a tag the user may have set themselves.
      const userFacingTags = (agent?.tags ?? []).filter((t) => {
        const lower = t.toLowerCase();
        return (
          !lower.startsWith("host_mode:") &&
          !lower.startsWith("preset:") &&
          !lower.startsWith("migration:")
        );
      });
      // TODO(aura-network-migration): drop tag dual-write after aura-network
      // schema ships (docs/migrations/2026-04-17-marketplace-agent-fields.md).
      // Until then, we keep writing `listing_status:<x>` tags alongside the
      // typed field so older aura-network instances still see the value.
      const hasLegacySystemTag =
        (agent?.tags ?? []).some((t) => {
          const lower = t.toLowerCase();
          return (
            lower.startsWith("host_mode:") ||
            lower.startsWith("preset:") ||
            lower.startsWith("migration:")
          );
        });
      const existingListingStatusTag = userFacingTags.some((t) =>
        t.toLowerCase().startsWith("listing_status:"),
      );
      const shouldPatchTags =
        listingStatus !== DEFAULT_LISTING_STATUS ||
        existingListingStatusTag ||
        hasLegacySystemTag;
      const tagsPayload = shouldPatchTags
        ? mergeListingStatusTag(userFacingTags, listingStatus)
        : undefined;
      // Prefer the typed `expertise` column on the agent; fall back to tags
      // for agents that haven't been resaved since the Phase 3 rollout and
      // therefore still carry the values in their tag set only.
      const expertiseSlugs = agent?.expertise?.length
        ? agent.expertise.filter((slug) => MARKETPLACE_EXPERTISE_SLUG_SET.has(slug))
        : expertiseSlugsFromTags(agent?.tags);
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
      const basePayload = {
        org_id: agent?.org_id ?? activeOrg?.org_id,
        name: trimmedName,
        role: roleToSend,
        personality: personality.trim(),
        system_prompt: systemPrompt.trim(),
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
      let saved: Agent;
      if (agent) {
        // Update path: `permissions` is optional and we never edit it from
        // this form today, so we pass `undefined` meaning "don't change".
        saved = await api.agents.update(agent.agent_id, basePayload);
      } else {
        // Create path: `permissions` is required. New agents always spawn
        // with an empty permissions bundle (no cross-agent capabilities);
        // the CEO bootstrap has its own dedicated endpoint.
        const createPayload: Parameters<typeof api.agents.create>[0] = {
          ...basePayload,
          icon: basePayload.icon ?? "",
          permissions: cloneAgentPermissions(emptyAgentPermissions()),
        };
        saved = await api.agents.create(createPayload);
      }
      onSaved(saved);
      if (closeOnSave) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally { setSaving(false); }
  }, [name, role, personality, systemPrompt, icon, adapterType, environment, authSource, integrationId, defaultModel, localWorkspacePath, initialLocalWorkspacePath, listingStatus, agent, activeOrg?.org_id, isMobileLayout, isSuperAgent, onSaved, closeOnSave, onClose]);

  return {
    name, setName, role, setRole, isSuperAgent, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon, setIcon,
    adapterType, setAdapterType, environment, setEnvironment,
    authSource, setAuthSource, showAdvancedRuntime, setShowAdvancedRuntime,
    integrationId, setIntegrationId, defaultModel, setDefaultModel,
    localWorkspacePath, setLocalWorkspacePath,
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

function cloneAgentPermissions(p: AgentPermissions): AgentPermissions {
  return {
    scope: {
      orgs: [...p.scope.orgs],
      projects: [...p.scope.projects],
      agent_ids: [...p.scope.agent_ids],
    },
    capabilities: p.capabilities.map((c) => ({ ...c })),
  };
}
