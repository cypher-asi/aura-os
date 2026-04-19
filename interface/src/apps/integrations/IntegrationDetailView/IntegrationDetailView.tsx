import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Plug } from "lucide-react";
import { IntegrationEditor } from "../../../components/IntegrationEditor";
import { useIntegrationsManager } from "../../../hooks/use-integrations-manager";
import { getIntegrationDefinition } from "../../../lib/integrationCatalog";

export function IntegrationDetailView() {
  const { provider } = useParams<{ provider: string }>();
  const { integrations, busyId, canManage, create, update, remove } = useIntegrationsManager();

  const definition = provider ? getIntegrationDefinition(provider) : undefined;

  // When a workspace already has a matching integration for this provider we
  // edit it in place; otherwise the same editor doubles as an "Add" form.
  // This mirrors the settings modal flow and keeps a single code path for
  // both cases.
  const integration = useMemo(() => {
    if (!provider) return null;
    return integrations.find((item) => item.provider === provider) ?? null;
  }, [integrations, provider]);

  if (!provider || !definition) {
    return (
      <PageEmptyState
        icon={<Plug size={32} />}
        title="Integration not found"
        description="Pick an integration from the left panel."
      />
    );
  }

  return (
    <IntegrationEditor
      provider={provider}
      integration={integration}
      canManage={canManage}
      busyId={busyId}
      onCreate={create}
      onUpdate={update}
      onDelete={remove}
    />
  );
}

export function IntegrationsEmptyView() {
  return (
    <PageEmptyState
      icon={<Plug size={32} />}
      title="Integrations"
      description="Pick an integration from the left panel to connect or configure it."
    />
  );
}
