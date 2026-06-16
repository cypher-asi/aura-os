import { useState } from "react";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { AlertTriangle, Download } from "lucide-react";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useUpdateStatus } from "../UpdateControl/useUpdateStatus";
import { useIsAnyStreaming } from "../../hooks/stream/hooks";
import { FORCED_UPGRADE_THRESHOLD, useReleasesBehind } from "./useReleasesBehind";
import styles from "./ForcedUpgradeOverlay.module.css";

interface GateSnapshot {
  behind: number;
  currentVersion: string | null;
  latestVersion: string | null;
}

/**
 * Hard-blocking, full-screen gate shown when a desktop build is
 * `FORCED_UPGRADE_THRESHOLD`+ releases behind the latest on its channel.
 * Self-gates on the native updater being available, so it renders nothing
 * on web/mobile/dev builds. Once gated, the snapshot is latched so the
 * overlay stays up through the install lifecycle (status flips away from
 * `available` while downloading/installing) and only disappears when the
 * upgraded app relaunches.
 *
 * Latching is deferred while any stream is active so the gate never interrupts
 * an in-progress turn/extraction — it appears once the user is idle. This only
 * gates the initial latch; a stream starting after the gate is shown does not
 * dismiss it.
 */
export function ForcedUpgradeOverlay(): React.ReactElement | null {
  const { features } = useAuraCapabilities();
  const {
    supported,
    status,
    currentVersion,
    availableVersion,
    channel,
    updateBaseUrl,
    error,
    installPending,
    installUpdate,
  } = useUpdateStatus();

  const nativeUpdater = !!features.nativeUpdater && supported;
  const updateAvailable = status === "available";

  const releasesBehind = useReleasesBehind({
    enabled: nativeUpdater && updateAvailable,
    currentVersion,
    latestVersion: availableVersion,
    channel,
    updateBaseUrl,
  });

  // Don't latch (show) the gate while an operation is streaming, so a forced
  // upgrade never interrupts an in-progress turn/extraction. Once the user is
  // idle the gate latches and shows — a defer, not a cancel.
  const anyStreaming = useIsAnyStreaming();

  const forcedNow =
    updateAvailable &&
    releasesBehind !== null &&
    releasesBehind >= FORCED_UPGRADE_THRESHOLD;

  // Latch the gate the first time we observe the forced condition. The
  // backend flips `status` away from `available` (and the distance hook
  // turns indeterminate) while downloading/installing, so without the
  // latch the overlay would vanish mid-upgrade. This is React's
  // "adjusting state during render" pattern: the guarded comparison keeps
  // it from looping, and no effect/ref is involved.
  const [gate, setGate] = useState<GateSnapshot | null>(null);
  if (
    forcedNow &&
    !anyStreaming &&
    releasesBehind !== null &&
    (gate === null ||
      gate.behind !== releasesBehind ||
      gate.currentVersion !== currentVersion ||
      gate.latestVersion !== availableVersion)
  ) {
    setGate({
      behind: releasesBehind,
      currentVersion,
      latestVersion: availableVersion,
    });
  }

  if (!nativeUpdater || !gate) return null;

  const isBusy =
    status === "downloading" || status === "installing" || installPending;
  const isFailed = status === "failed";

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-upgrade-title"
      data-testid="forced-upgrade-overlay"
    >
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden>
          {isBusy ? <Spinner size="lg" /> : <AlertTriangle size={40} />}
        </div>
        <Text
          as="h1"
          size="xl"
          weight="semibold"
          id="forced-upgrade-title"
          className={styles.title}
        >
          You&rsquo;re {gate.behind} versions behind the latest
        </Text>
        <Text as="p" variant="muted" className={styles.body}>
          For the best experience, please upgrade to the latest version before
          proceeding.
        </Text>
        {gate.currentVersion || gate.latestVersion ? (
          <Text
            as="p"
            variant="muted"
            size="sm"
            className={styles.versions}
            data-testid="forced-upgrade-versions"
          >
            Current v{gate.currentVersion ?? "?"} &rarr; Latest v
            {gate.latestVersion ?? "?"}
          </Text>
        ) : null}

        {isFailed ? (
          <Text
            as="p"
            size="sm"
            className={styles.error}
            data-testid="forced-upgrade-error"
          >
            Upgrade failed: {error || "unknown error"}. Please try again.
          </Text>
        ) : null}

        <Button
          variant="primary"
          size="md"
          onClick={() => void installUpdate()}
          disabled={isBusy}
          icon={isBusy ? <Spinner size="sm" /> : <Download size={18} />}
          className={styles.action}
          data-testid="forced-upgrade-action"
        >
          {isBusy ? "Upgrading\u2026" : isFailed ? "Try again" : "Upgrade"}
        </Button>
      </div>
    </div>
  );
}
