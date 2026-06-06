import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type { OrgIntegration } from "../shared/types";
import { useOrgStore } from "../stores/org-store";
import { useAuth } from "../stores/auth-store";

interface CreateIntegrationPayload {
  name: string;
  provider: string;
  kind?: OrgIntegration["kind"];
  default_model?: string | null;
  provider_config?: Record<string, unknown> | null;
  api_key?: string | null;
  enabled?: boolean | null;
}

interface UpdateIntegrationPayload {
  name?: string;
  provider?: string;
  kind?: OrgIntegration["kind"];
  default_model?: string | null;
  provider_config?: Record<string, unknown> | null;
  api_key?: string | null;
  enabled?: boolean | null;
}

/**
 * Self-contained hook that manages workspace integrations without depending on
 * the Team Settings modal. Ensures `integrations` are loaded for the active
 * org and exposes create/update/delete helpers that feed back into
 * `useOrgStore`.
 */
export function useIntegrationsManager() {
  const { activeOrg, integrations, refreshIntegrations } = useOrgStore(
    useShallow((state) => ({
      activeOrg: state.activeOrg,
      integrations: state.integrations,
      refreshIntegrations: state.refreshIntegrations,
    })),
  );
  const refreshMembers = useOrgStore((state) => state.refreshMembers);
  const { user } = useAuth();
  const orgId = activeOrg?.org_id;

  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    void refreshMembers();
    void refreshIntegrations();
  }, [orgId, refreshIntegrations, refreshMembers]);

  // Membership / role information lives in `useOrgStore.members`, but the
  // settings modal already fetches that lazily. Mirror the "admin or owner"
  // derivation here by pulling members straight from the store so the
  // Integrations app can gate management behind the same check without
  // requiring the settings modal to have been opened first.
  const members = useOrgStore((state) => state.members);
  const myRole = members.find(
    (member) => member.user_id === user?.network_user_id,
  )?.role;
  const isOwner = Boolean(
    user?.network_user_id &&
      activeOrg?.owner_user_id &&
      activeOrg.owner_user_id === user.network_user_id,
  );
  const canManage = isOwner || myRole === "owner" || myRole === "admin";

  const create = useCallback(
    async (data: CreateIntegrationPayload) => {
      if (!orgId) return null;
      setBusyId("new");
      try {
        const integration = await api.orgs.createIntegration(orgId, data);
        await refreshIntegrations();
        return integration;
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refreshIntegrations],
  );

  const update = useCallback(
    async (integrationId: string, data: UpdateIntegrationPayload) => {
      if (!orgId) return null;
      setBusyId(integrationId);
      try {
        const integration = await api.orgs.updateIntegration(
          orgId,
          integrationId,
          data,
        );
        await refreshIntegrations();
        return integration;
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refreshIntegrations],
  );

  const remove = useCallback(
    async (integrationId: string) => {
      if (!orgId) return;
      setBusyId(integrationId);
      try {
        await api.orgs.deleteIntegration(orgId, integrationId);
        await refreshIntegrations();
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refreshIntegrations],
  );

  const connectGoogle = useCallback(async () => {
    if (!orgId) return null;
    setBusyId("google_oauth");
    try {
      const { authorization_url } = await api.orgs.startGoogleOAuth(orgId);
      const popup = window.open(
        authorization_url,
        "aura-google-oauth",
        "width=520,height=720",
      );
      if (!popup) {
        const fallback = await api.orgs.startGoogleOAuth(
          orgId,
          window.location.href,
        );
        window.location.href = fallback.authorization_url;
        return null;
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          window.clearInterval(timer);
          resolve();
        };
        const onMessage = (event: MessageEvent) => {
          if (
            event.source === popup &&
            event.data?.type === "aura-google-oauth-complete"
          ) {
            finish();
          }
        };
        const timer = window.setInterval(() => {
          if (popup.closed) finish();
        }, 750);
        window.addEventListener("message", onMessage);
      });
      await refreshIntegrations();
      return true;
    } finally {
      setBusyId(null);
    }
  }, [orgId, refreshIntegrations]);

  return {
    integrations,
    busyId,
    canManage,
    create,
    update,
    remove,
    connectGoogle,
  };
}
