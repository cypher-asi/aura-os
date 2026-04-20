import { Button, Spinner, Text } from "@cypher-asi/zui";
import { Check, Download, RefreshCw } from "lucide-react";
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

export function UpdateControl() {
  const {
    supported,
    loaded,
    status,
    availableVersion,
    error,
    lastCheckedAt,
    checkPending,
    installPending,
    checkForUpdates,
    installUpdate,
  } = useUpdateStatus();

  if (!supported) {
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

  if (!loaded) {
    return (
      <div className={styles.updateControl} data-testid="settings-update-loading">
        <Spinner size="sm" />
        <Text as="span" variant="muted" size="sm">
          Checking update status&hellip;
        </Text>
      </div>
    );
  }

  const lastCheckedLabel = formatLastChecked(lastCheckedAt);
  const isChecking = status === "checking" || checkPending;
  const isDownloading = status === "downloading";
  const isInstalling = status === "installing" || installPending;

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

  if (status === "available") {
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
  } else if (status === "failed") {
    testId = "settings-update-failed";
    message = (
      <Text as="span" size="sm" className={styles.updateError}>
        Update failed: {error || "unknown error"}
      </Text>
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
    <div className={styles.updateControl} data-testid={testId}>
      <div className={styles.updateStatus}>{message}</div>
      {actions ? <div className={styles.updateActions}>{actions}</div> : null}
      {lastCheckedLabel ? (
        <Text
          as="span"
          variant="muted"
          size="xs"
          data-testid="settings-update-last-checked"
        >
          Last checked: {lastCheckedLabel}
        </Text>
      ) : null}
    </div>
  );
}
