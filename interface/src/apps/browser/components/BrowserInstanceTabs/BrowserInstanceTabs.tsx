import { useMemo } from "react";
import type { BrowserInstance } from "../../../../stores/browser-panel-store";
import {
  InstanceTabs,
  type InstanceTab,
} from "../../../../components/InstanceTabs";

export interface BrowserInstanceTabsProps {
  instances: BrowserInstance[];
  activeClientId: string | null;
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
  onAdd: () => void;
}

export function BrowserInstanceTabs({
  instances,
  activeClientId,
  onActivate,
  onClose,
  onAdd,
}: BrowserInstanceTabsProps) {
  const tabs = useMemo<InstanceTab[]>(
    () => instances.map((i) => ({ id: i.clientId, title: i.title })),
    [instances],
  );

  return (
    <InstanceTabs
      tabs={tabs}
      activeId={activeClientId}
      onActivate={onActivate}
      onClose={onClose}
      onAdd={onAdd}
      addAriaLabel="New preview tab"
    />
  );
}
