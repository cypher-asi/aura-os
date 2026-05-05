import { Button, Spinner, Text } from "@cypher-asi/zui";
import { AlertTriangle, Check, Download, RefreshCw } from "lucide-react";
import { useUpdateStatus } from "./useUpdateStatus";
import styles from "./UpdateControl.module.css";

function formatLastChecked(timestamp: number | null, locale?: string): string | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export type UpdateControlLayout = "inline" | "panel";

interface UpdateControlProps {
  /**
   * `inline` renders a compact single-row control intended to live in the
   * `rowControl` slot of a settings row. `panel` renders a full-width
   * attention card intended to sit on its own row when an update is
   * actionable (available / downloading / installing / failed).
   */
  layout?: UpdateControlLayout;
}

export function UpdateControl({ layout = "inline" }: UpdateControlProps = {}) {
  const {
    supported,
    loaded,
    status,
    availableVersion,
    error,
    lastStep,
    lastCheckedAt,
    checkPending,
    installPending,
    revealPending,
    checkForUpdates,
    installUpdate,
    revealUpdaterLogs,
  } = useUpdateStatus();

  if (!supported) {
    if (layout === "panel") {
      return null;
    }
    return (
      <Text
        as="div"
        variant="muted"
        size="sm"
        className={styles.updateUnsupported}
        data-testid="settings-update-unsupported"
      >
        Updates are delivered automatically by the server.
      </Text>
    );
  }

  const isChecking = status === "checking" || checkPending;
  const isDownloading = status === "downloading";
  const isInstalling = status === "installing" || installPending;
  const isAvailable = status === "available";
  const isFailed = status === "failed";

  if (!loaded) {
    if (layout === "panel") {
      return null;
    }
    return (
      <div className={styles.updateControl} data-testid="settings-update-loading">
        <Spinner size="sm" />
        <Text as="span" variant="muted" size="sm">
          Checking update status&hellip;
        </Text>
      </div>
    );
  }

  if (layout === "panel") {
    if (!(isAvailable || isDownloading || isInstalling || isFailed)) {
      return null;
    }
    return renderPanel({
      status,
      availableVersion,
      error,
      lastStep,
      isChecking,
      isDownloading,
      isInstalling,
      isFailed,
      isAvailable,
      installUpdate,
      checkForUpdates,
      revealUpdaterLogs,
      revealPending,
    });
  }

  return renderInline({
    status,
    availableVersion,
    error,
    lastStep,
    lastCheckedAt,
    isChecking,
    isDownloading,
    isInstalling,
    isFailed,
    isAvailable,
    installUpdate,
    checkForUpdates,
    revealUpdaterLogs,
    revealPending,
  });
}

interface RenderCommon {
  status: ReturnType<typeof useUpdateStatus>["status"];
  availableVersion: string | null;
  error: string | null;
  lastStep: string | null;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isFailed: boolean;
  isAvailable: boolean;
  installUpdate: () => Promise<unknown> | void;
  checkForUpdates: () => Promise<unknown> | void;
  revealUpdaterLogs: () => Promise<unknown> | void;
  revealPending: boolean;
}

function formatLastStepLabel(step: string | null): string | null {
  if (!step) return null;
  return step
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderInline(
  props: RenderCommon & { lastCheckedAt: number | null },
): React.ReactElement {
  const {
    status,
    availableVersion,
    error,
    lastStep,
    isChecking,
    isDownloading,
    isInstalling,
    isFailed,
    isAvailable,
    lastCheckedAt,
    checkForUpdates,
    installUpdate,
    revealUpdaterLogs,
    revealPending,
  } = props;

  const lastCheckedLabel = formatLastChecked(lastCheckedAt);

  const checkButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void checkForUpdates()}
      disabled={isChecking || isDownloading || isInstalling}
      icon={isChecking ? <Spinner size="sm" /> : <RefreshCw size={14} />}
      data-testid="settings-update-check"
    >
      {isChecking ? "Checking\u2026" : "Check for updates"}
    </Button>
  );

  let message: React.ReactNode;
  let actions: React.ReactNode;
  let testId: string;

  if (isAvailable) {
    testId = "settings-update-available";
    message = (
      <Text as="span" size="sm">
        Update available: v{availableVersion ?? "?"}
      </Text>
    );
    actions = (
      <>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void installUpdate()}
          disabled={isInstalling}
          icon={isInstalling ? <Spinner size="sm" /> : <Download size={14} />}
          data-testid="settings-update-install"
        >
          {isInstalling ? "Preparing\u2026" : "Install update"}
        </Button>
        {checkButton}
      </>
    );
  } else if (isDownloading) {
    testId = "settings-update-downloading";
    message = (
      <>
        <Spinner size="sm" />
        <Text as="span" size="sm">
          Downloading v{availableVersion ?? "?"}&hellip;
        </Text>
      </>
    );
    actions = null;
  } else if (isInstalling) {
    testId = "settings-update-installing";
    message = (
      <>
        <Spinner size="sm" />
        <Text as="span" size="sm">
          Installing v{availableVersion ?? "?"} and restarting&hellip;
        </Text>
      </>
    );
    actions = null;
  } else if (isFailed) {
    testId = "settings-update-failed";
    const stepLabel = formatLastStepLabel(lastStep);
    message = (
      <div>
        <Text as="div" size="sm" className={styles.updateError}>
          Update failed: {error || "unknown error"}
        </Text>
        {stepLabel ? (
          <Text
            as="div"
            size="sm"
            className={styles.updateErrorStep}
            data-testid="settings-update-failed-step"
          >
            Stopped at: {stepLabel}.{" "}
            <button
              type="button"
              className={styles.updateDiagnosticsLink}
              onClick={() => void revealUpdaterLogs()}
              disabled={revealPending}
              data-testid="settings-update-reveal-logs"
            >
              {revealPending ? "Opening logs\u2026" : "Show updater logs"}
            </button>
          </Text>
        ) : null}
      </div>
    );
    actions = (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void checkForUpdates()}
        disabled={isChecking}
        icon={isChecking ? <Spinner size="sm" /> : <RefreshCw size={14} />}
        data-testid="settings-update-retry"
      >
        {isChecking ? "Checking\u2026" : "Try again"}
      </Button>
    );
  } else if (isChecking) {
    testId = "settings-update-checking";
    message = (
      <>
        <Spinner size="sm" />
        <Text as="span" size="sm">
          Checking for updates&hellip;
        </Text>
      </>
    );
    actions = null;
  } else {
    testId = "settings-update-latest";
    message = (
      <>
        <Check size={14} className={styles.updateCheckIcon} aria-hidden />
        <Text as="span" size="sm" data-testid="settings-update-latest-message">
          You&rsquo;re on the latest version.
        </Text>
      </>
    );
    actions = checkButton;
  }

  return (
    <div
      className={styles.updateControl}
      data-layout="inline"
      data-status={status}
      data-testid={testId}
    >
      <div className={styles.updateStatusRow}>
        <div className={styles.updateStatus}>{message}</div>
        {actions ? <div className={styles.updateActions}>{actions}</div> : null}
      </div>
      {lastCheckedLabel ? (
        <Text
          as="span"
          variant="muted"
          size="xs"
          className={styles.updateLastChecked}
          data-testid="settings-update-last-checked"
        >
          Last checked: {lastCheckedLabel}
        </Text>
      ) : null}
    </div>
  );
}

function renderPanel(props: RenderCommon): React.ReactElement {
  const {
    availableVersion,
    error,
    lastStep,
    isChecking,
    isDownloading,
    isInstalling,
    isFailed,
    isAvailable,
    installUpdate,
    checkForUpdates,
    revealUpdaterLogs,
    revealPending,
  } = props;

  let variant: "available" | "progress" | "failed";
  let title: string;
  let description: React.ReactNode;
  let icon: React.ReactNode;
  let actions: React.ReactNode = null;
  let testId: string;

  if (isFailed) {
    variant = "failed";
    title = "Update failed";
    const stepLabel = formatLastStepLabel(lastStep);
    description = (
      <>
        <Text as="div" size="sm" className={styles.updateError}>
          {error || "An unknown error occurred while installing the update."}
        </Text>
        {stepLabel ? (
          <Text
            as="div"
            size="sm"
            className={styles.updateErrorStep}
            data-testid="settings-update-panel-failed-step"
          >
            Stopped at: {stepLabel}.{" "}
            <button
              type="button"
              className={styles.updateDiagnosticsLink}
              onClick={() => void revealUpdaterLogs()}
              disabled={revealPending}
              data-testid="settings-update-panel-reveal-logs"
            >
              {revealPending ? "Opening logs\u2026" : "Show updater logs"}
            </button>
          </Text>
        ) : null}
      </>
    );
    icon = <AlertTriangle size={18} aria-hidden />;
    actions = (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void checkForUpdates()}
        disabled={isChecking}
        icon={isChecking ? <Spinner size="sm" /> : <RefreshCw size={14} />}
        data-testid="settings-update-retry"
      >
        {isChecking ? "Checking\u2026" : "Try again"}
      </Button>
    );
    testId = "settings-update-panel-failed";
  } else if (isDownloading) {
    variant = "progress";
    title = `Downloading v${availableVersion ?? "?"}`;
    description = (
      <Text as="span" variant="muted" size="sm">
        Aura is fetching the update in the background. You can keep working.
      </Text>
    );
    icon = <Spinner size="md" />;
    testId = "settings-update-panel-downloading";
  } else if (isInstalling) {
    variant = "progress";
    title = `Installing v${availableVersion ?? "?"}`;
    description = (
      <Text as="span" variant="muted" size="sm">
        Aura will close momentarily to complete the installation and relaunch.
      </Text>
    );
    icon = <Spinner size="md" />;
    testId = "settings-update-panel-installing";
  } else if (isAvailable) {
    variant = "available";
    title = `Update available: v${availableVersion ?? "?"}`;
    description = (
      <Text as="span" variant="muted" size="sm">
        A new version of Aura is ready to install. Aura will restart automatically.
      </Text>
    );
    icon = <Download size={18} aria-hidden />;
    actions = (
      <Button
        variant="primary"
        size="sm"
        onClick={() => void installUpdate()}
        disabled={isInstalling}
        icon={isInstalling ? <Spinner size="sm" /> : <Download size={14} />}
        data-testid="settings-update-install"
      >
        {isInstalling ? "Preparing\u2026" : "Install update"}
      </Button>
    );
    testId = "settings-update-panel-available";
  } else {
    return <></>;
  }

  return (
    <div
      className={styles.updatePanel}
      data-variant={variant}
      data-testid={testId}
    >
      <div className={styles.updatePanelIcon} aria-hidden>
        {icon}
      </div>
      <div className={styles.updatePanelBody}>
        <Text as="div" size="sm" className={styles.updatePanelTitle}>
          {title}
        </Text>
        <div className={styles.updatePanelDescription}>{description}</div>
      </div>
      {actions ? <div className={styles.updatePanelActions}>{actions}</div> : null}
    </div>
  );
}
