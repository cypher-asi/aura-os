import { useEffect, useState } from "react";
import { Button, Panel, Text } from "@cypher-asi/zui";
import {
  desktopApi,
  type BrowserExecutableStatus,
} from "../../../shared/api/desktop";
import { isDesktopRuntime } from "../../../shared/lib/native-runtime";
import styles from "./AdvancedSection.module.css";

const SOURCE_LABELS: Record<BrowserExecutableStatus["source"], string> = {
  saved_setting: "Selected in AURA settings",
  process_environment: "BROWSER_EXECUTABLE_PATH",
  user_environment: "Windows user environment",
  automatic_discovery: "Detected automatically",
  not_found: "Not found",
  unsupported: "Managed by the server",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not update the browser setting.";
}

export function AdvancedSection() {
  const isDesktop = isDesktopRuntime();
  const [status, setStatus] = useState<BrowserExecutableStatus | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    desktopApi
      .getBrowserExecutable()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        if (next.source === "saved_setting") {
          setPath(next.resolved_path ?? "");
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [isDesktop]);

  const chooseBrowser = async () => {
    setMessage(null);
    try {
      const selected = await desktopApi.pickFile();
      if (selected) setPath(selected);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const saveBrowser = async (nextPath: string | null) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await desktopApi.setBrowserExecutable(nextPath);
      setStatus(next);
      setPath(next.source === "saved_setting" ? (next.resolved_path ?? "") : "");
      setMessage(nextPath ? "Browser saved. Preview will use it immediately." : "Automatic browser detection restored.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.advancedPanel}
      data-testid="settings-advanced-panel"
    >
      <Text weight="semibold" size="sm">
        Advanced
      </Text>
      {isDesktop ? (
        <section className={styles.browserSection} aria-labelledby="preview-browser-heading">
          <div className={styles.sectionHeading}>
            <Text as="h3" id="preview-browser-heading" weight="semibold" size="sm">
              Preview browser
            </Text>
            <Text variant="muted" size="sm">
              AURA automatically finds Microsoft Edge, Google Chrome, or Chromium. Choose the executable here if your company installs it in a managed location.
            </Text>
          </div>
          <label className={styles.fieldLabel} htmlFor="browser-executable-path">
            Browser executable path
          </label>
          <div className={styles.pathRow}>
            <input
              id="browser-executable-path"
              className={styles.pathInput}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={status?.resolved_path ?? "Select Microsoft Edge, Chrome, or Chromium"}
              spellCheck={false}
              autoComplete="off"
            />
            <Button variant="secondary" size="sm" onClick={chooseBrowser} disabled={busy}>
              Choose…
            </Button>
          </div>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => saveBrowser(path.trim())} disabled={busy || !path.trim()}>
              {busy ? "Saving…" : "Save browser"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => saveBrowser(null)} disabled={busy}>
              Use automatic detection
            </Button>
          </div>
          {status ? (
            <Text variant="muted" size="sm" data-testid="browser-executable-status">
              {status.available ? SOURCE_LABELS[status.source] : `${SOURCE_LABELS[status.source]} (unavailable)`}
              {status.resolved_path ? `: ${status.resolved_path}` : ". Select a browser executable to enable Preview."}
            </Text>
          ) : null}
          {message ? (
            <Text size="sm" role="status" className={styles.message}>
              {message}
            </Text>
          ) : null}
        </section>
      ) : (
        <Text variant="muted" size="sm">
          Browser runtime settings are managed by the AURA server. Server operators can set <code>BROWSER_EXECUTABLE_PATH</code> for managed installations. See <code>.env.example</code> for other options.
        </Text>
      )}
    </Panel>
  );
}
