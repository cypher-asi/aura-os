import { Button, Spinner, Text } from "@cypher-asi/zui";
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { api } from "../../api/client";
import type { DesktopUpdateBundleInfo } from "../../shared/api/desktop";
import { useUpdateStatus } from "./useUpdateStatus";
import styles from "./UpdateControl.module.css";

/**
 * The bundle classification only triggers the macOS recovery card when
 * `cargo_packager_updater::Update::install` cannot succeed in place.
 * Both flags are independent root causes (translocation is a read-only
 * mount itself; a DMG is a read-only mount that we mark separately so
 * the UI can phrase the explanation differently). Surfaced via a shared
 * predicate so the inline + panel branches stay in sync.
 */
function bundleBlocksInPlaceUpdate(info: DesktopUpdateBundleInfo | null): boolean {
  if (!info) return false;
  return Boolean(info.translocated || info.read_only);
}

function bundleReason(info: DesktopUpdateBundleInfo | null): string {
  if (!info) return "a read-only location";
  if (info.translocated) return "App Translocation";
  if (info.on_dmg) return "a mounted disk image";
  if (info.read_only) return "a read-only volume";
  return "a read-only location";
}

export function formatLastChecked(
  timestamp: number | null,
  locale?: string,
): string | null {
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
  /**
   * When `false`, suppress the inline "Last checked: …" line. Use this when
   * the consumer renders that information itself (e.g. aligned with the row
   * description on the left side of a settings row).
   */
  showLastChecked?: boolean;
}

export function UpdateControl({
  layout = "inline",
  showLastChecked = true,
}: UpdateControlProps = {}) {
  const {
    supported,
    loaded,
    status,
    availableVersion,
    error,
    lastStep,
    lastCheckedAt,
    bundleInfo,
    checkPending,
    installPending,
    revealPending,
    relocatePending,
    checkForUpdates,
    installUpdate,
    revealUpdaterLogs,
    relocateAndRelaunch,
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
      bundleInfo,
      isChecking,
      isDownloading,
      isInstalling,
      isFailed,
      isAvailable,
      installUpdate,
      checkForUpdates,
      revealUpdaterLogs,
      revealPending,
      relocateAndRelaunch,
      relocatePending,
    });
  }

  return renderInline({
    status,
    availableVersion,
    error,
    lastStep,
    bundleInfo,
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
    relocateAndRelaunch,
    relocatePending,
    showLastChecked,
  });
}

interface RenderCommon {
  status: ReturnType<typeof useUpdateStatus>["status"];
  availableVersion: string | null;
  error: string | null;
  lastStep: string | null;
  bundleInfo: DesktopUpdateBundleInfo | null;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isFailed: boolean;
  isAvailable: boolean;
  installUpdate: () => Promise<unknown> | void;
  checkForUpdates: () => Promise<unknown> | void;
  revealUpdaterLogs: () => Promise<unknown> | void;
  revealPending: boolean;
  relocateAndRelaunch: () => Promise<unknown> | void;
  relocatePending: boolean;
}

function ReleaseNotesLink({ version }: { version: string | null }) {
  const tag = version?.replace(/^v/, "");
  if (!tag || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(tag)) return null;
  return (
    <a
      className={styles.releaseNotesLink}
      href={`https://github.com/cypher-asi/aura-os/releases/tag/${encodeURIComponent(`v${tag}`)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`What's changed in Aura ${version} (opens in a new tab)`}
    >
      What&rsquo;s changed <ExternalLink size={14} aria-hidden />
    </a>
  );
}

function formatLastStepLabel(step: string | null): string | null {
  if (!step) return null;
  return step
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface MacRecoveryProps {
  bundleInfo: DesktopUpdateBundleInfo;
  relocateAndRelaunch: () => Promise<unknown> | void;
  relocatePending: boolean;
  revealUpdaterLogs: () => Promise<unknown> | void;
  revealPending: boolean;
  testIdPrefix: string;
}

/**
 * Failure block we render in place of the generic "Update failed: …"
 * message when the running bundle is on a read-only mount. Explains
 * the cause in plain language and offers two recoveries:
 *
 *  - Primary: `relocateAndRelaunch()` runs an authenticated
 *    `osascript` ditto + xattr-clear into `/Applications`, then
 *    relaunches the moved bundle.
 *  - Secondary: Reveal the running bundle in Finder so the user can
 *    move it manually if they prefer.
 *
 * Both branches keep the existing "Show updater logs" affordance for
 * post-mortem inspection.
 */
function MacRecoveryBlock({
  bundleInfo,
  relocateAndRelaunch,
  relocatePending,
  revealUpdaterLogs,
  revealPending,
  testIdPrefix,
}: MacRecoveryProps): React.ReactElement {
  const reason = bundleReason(bundleInfo);
  const handleReveal = () => {
    if (!bundleInfo.path) return;
    void api.openPath(bundleInfo.path);
  };
  return (
    <div data-testid={`${testIdPrefix}-mac-readonly`}>
      <Text as="div" size="sm" className={styles.updateError}>
        Aura can&rsquo;t update itself from this location.
      </Text>
      <Text
        as="div"
        size="sm"
        className={styles.updateErrorStep}
        data-testid={`${testIdPrefix}-mac-readonly-explanation`}
      >
        Aura is running from {reason} and the installer can&rsquo;t replace the
        running app on a read-only volume. Move Aura.app to your Applications
        folder, then reopen Aura and try again.
      </Text>
      {bundleInfo.path ? (
        <Text
          as="div"
          size="xs"
          variant="muted"
          className={styles.updateErrorStep}
        >
          Bundle path: <code>{bundleInfo.path}</code>
        </Text>
      ) : null}
      <div className={styles.updateMacRecoveryActions}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void relocateAndRelaunch()}
          disabled={relocatePending}
          icon={relocatePending ? <Spinner size="sm" /> : <Download size={14} />}
          data-testid={`${testIdPrefix}-mac-relocate`}
        >
          {relocatePending
            ? "Moving\u2026"
            : "Move to /Applications and relaunch"}
        </Button>
        {bundleInfo.path ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReveal}
            icon={<FolderOpen size={14} />}
            data-testid={`${testIdPrefix}-mac-reveal-bundle`}
          >
            Reveal in Finder
          </Button>
        ) : null}
        <button
          type="button"
          className={styles.updateDiagnosticsLink}
          onClick={() => void revealUpdaterLogs()}
          disabled={revealPending}
          data-testid={`${testIdPrefix}-mac-reveal-logs`}
        >
          {revealPending ? "Opening logs\u2026" : "Show updater logs"}
        </button>
      </div>
    </div>
  );
}

function renderInline(
  props: RenderCommon & {
    lastCheckedAt: number | null;
    showLastChecked: boolean;
  },
): React.ReactElement {
  const {
    status,
    availableVersion,
    error,
    lastStep,
    bundleInfo,
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
    relocateAndRelaunch,
    relocatePending,
    showLastChecked,
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
        <ReleaseNotesLink version={availableVersion} />
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
    if (bundleBlocksInPlaceUpdate(bundleInfo) && bundleInfo) {
      // Failure is the macOS read-only-mount case. The recovery card
      // replaces the generic message + step label so the actionable
      // path (Move to /Applications) is the loudest thing on screen.
      message = (
        <MacRecoveryBlock
          bundleInfo={bundleInfo}
          relocateAndRelaunch={relocateAndRelaunch}
          relocatePending={relocatePending}
          revealUpdaterLogs={revealUpdaterLogs}
          revealPending={revealPending}
          testIdPrefix="settings-update-failed"
        />
      );
      actions = null;
    } else {
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
    }
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
      <div className={styles.updateStatus}>{message}</div>
      {actions ? <div className={styles.updateActions}>{actions}</div> : null}
      {showLastChecked && lastCheckedLabel ? (
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
    bundleInfo,
    isChecking,
    isDownloading,
    isInstalling,
    isFailed,
    isAvailable,
    installUpdate,
    checkForUpdates,
    revealUpdaterLogs,
    revealPending,
    relocateAndRelaunch,
    relocatePending,
  } = props;

  let variant: "available" | "progress" | "failed";
  let title: string;
  let description: React.ReactNode;
  let icon: React.ReactNode;
  let actions: React.ReactNode = null;
  let testId: string;

  if (isFailed) {
    variant = "failed";
    const stepLabel = formatLastStepLabel(lastStep);
    if (bundleBlocksInPlaceUpdate(bundleInfo) && bundleInfo) {
      title = "Aura can't update from this location";
      description = (
        <MacRecoveryBlock
          bundleInfo={bundleInfo}
          relocateAndRelaunch={relocateAndRelaunch}
          relocatePending={relocatePending}
          revealUpdaterLogs={revealUpdaterLogs}
          revealPending={revealPending}
          testIdPrefix="settings-update-panel-failed"
        />
      );
      // Recovery actions live inside MacRecoveryBlock so they sit next
      // to the explanation text rather than far-right of the panel.
      actions = null;
    } else {
      title = "Update failed";
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
    }
    icon = <AlertTriangle size={18} aria-hidden />;
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
      <>
        <ReleaseNotesLink version={availableVersion} />
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
      </>
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
