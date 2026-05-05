import { Spinner } from "@cypher-asi/zui";
import { PillButton } from "../PillButton";
import { useUpdateBanner } from "./useUpdateBanner";
import styles from "./UpdatePill.module.css";

export function UpdatePill() {
  const { data, enabled, installPending, handleInstallUpdate } =
    useUpdateBanner();

  if (!enabled || !data) return null;

  const { update } = data;
  const status = update.status;

  // The hook clears `installPending` on any non-"available" poll, so during the
  // brief window between click and the next status flip we still want to show
  // the busy state — hence treating `installPending` as installing too.
  const installingNow =
    installPending || status === "installing" || status === "downloading";

  if (status !== "available" && !installingNow) {
    return null;
  }

  const versionSuffix = update.version ? ` v${update.version}` : "";
  const ariaLabel = installingNow
    ? `Installing Aura update${versionSuffix}`
    : `Update Aura${versionSuffix ? ` to${versionSuffix}` : ""}`;

  return (
    <span className={`titlebar-no-drag ${styles.pillWrap}`}>
      <PillButton
        size="sm"
        className={styles.pill}
        disabled={installingNow}
        onClick={() => void handleInstallUpdate()}
        aria-label={ariaLabel}
        title={ariaLabel}
        icon={installingNow ? <Spinner size="sm" /> : undefined}
      >
        {installingNow ? "Installing\u2026" : "Update"}
      </PillButton>
    </span>
  );
}
