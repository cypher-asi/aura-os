import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ApiKeyInfo } from "../../types";
import { Page, Panel, Heading, Spinner, Text } from "@cypher-asi/zui";
import styles from "./SettingsView.module.css";

export function SettingsView() {
  const [info, setInfo] = useState<ApiKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getApiKeyInfo()
      .then(setInfo)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Page title="Settings" subtitle="Configuration status">
      <Panel variant="solid" border="solid" borderRadius="md" className={styles.settingsPanel}>
        <Heading level={4}>Claude API Key</Heading>

        <Text size="sm" className={styles.monoText}>
          {info?.configured ? "Configured" : "Not configured"}
        </Text>

        {!info?.configured && (
          <Text variant="muted" size="sm">
            Set <code>ANTHROPIC_API_KEY</code> in your <code>.env</code> file and restart the server.
          </Text>
        )}
      </Panel>
    </Page>
  );
}
