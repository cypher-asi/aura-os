import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { FolderSection } from "../../../components/FolderSection";
import { useIntegrationsManager } from "../../../hooks/use-integrations-manager";
import {
  getIntegrationGroups,
  type IntegrationGroupId,
} from "../integration-groups";
import styles from "./IntegrationsNav.module.css";

/**
 * Left menu for the Integrations app. Renders one collapsible `FolderSection`
 * per integration group (Communication, Productivity, Coding, ...), with a
 * row per provider. Selection is URL-driven via `/integrations/:provider` so
 * the main panel can re-render cleanly on navigation without a separate
 * selection store.
 */
export function IntegrationsNav() {
  const navigate = useNavigate();
  const { provider: selectedProvider } = useParams<{ provider?: string }>();
  const { integrations } = useIntegrationsManager();
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(getIntegrationGroups, []);

  const [expanded, setExpanded] = useState<Record<IntegrationGroupId, boolean>>(
    () => Object.fromEntries(groups.map((group) => [group.id, true])) as Record<IntegrationGroupId, boolean>,
  );

  const integrationsByProvider = useMemo(() => {
    const map = new Map<string, (typeof integrations)[number]>();
    for (const integration of integrations) {
      map.set(integration.provider, integration);
    }
    return map;
  }, [integrations]);

  const toggle = (id: IntegrationGroupId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        {groups.map((group) => (
          <FolderSection
            key={group.id}
            label={group.title}
            expanded={expanded[group.id] ?? true}
            onToggle={() => toggle(group.id)}
          >
            {group.providers.map((provider) => {
              const existing = integrationsByProvider.get(provider.id);
              const isActive = selectedProvider === provider.id;
              const isConnected = Boolean(existing);
              const statusClass = isConnected
                ? existing?.enabled
                  ? `${styles.statusDot} ${styles.statusDotConnected}`
                  : `${styles.statusDot} ${styles.statusDotDisabled}`
                : styles.statusDot;

              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`${styles.row} ${isActive ? styles.rowActive : ""}`}
                  onClick={() => navigate(`/integrations/${provider.id}`)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={
                    isConnected
                      ? `${provider.label} (connected)`
                      : provider.label
                  }
                >
                  <span className={styles.rowLabel}>{provider.label}</span>
                  <span className={statusClass} aria-hidden="true" />
                </button>
              );
            })}
          </FolderSection>
        ))}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
