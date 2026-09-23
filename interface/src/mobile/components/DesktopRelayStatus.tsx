import { RefreshCw } from "lucide-react";
import { useRelativeTime } from "../../hooks/use-relative-time";
import {
  refreshDesktopRelayEnvironment,
  useDesktopRelayStatus,
} from "../../shared/api/desktop-relay";

interface DesktopRelayStatusProps {
  className: string;
  dotClassName: string;
  copyClassName: string;
  iconClassName: string;
}

/**
 * Small, actionable connection affordance for mobile agent surfaces. The
 * relay is intentionally presented as a connection, not as a second agent:
 * tapping it only refreshes the desktop lease and never starts execution.
 */
export function DesktopRelayStatus({
  className,
  dotClassName,
  copyClassName,
  iconClassName,
}: DesktopRelayStatusProps) {
  const { status, environments, activeEnvironment } = useDesktopRelayStatus();
  const lastSeen = useRelativeTime(activeEnvironment?.last_seen_at);

  if (status === "idle" && !activeEnvironment) return null;

  let state: "checking" | "unknown" | "connected" | "offline" | "none";
  if (status === "loading") state = "checking";
  else if (status === "error") state = "unknown";
  else if (!activeEnvironment) state = "none";
  else state = activeEnvironment.connected ? "connected" : "offline";

  let title: string;
  let detail: string;
  if (state === "checking") {
    title = "Checking paired desktop";
    detail = "Tap to refresh";
  } else if (state === "connected") {
    title = `${activeEnvironment?.label ?? "Desktop"} connected`;
    detail = environments.length > 1 ? `${environments.length} paired desktops` : "Tap to refresh";
  } else if (state === "offline") {
    title = `${activeEnvironment?.label ?? "Desktop"} offline`;
    detail = lastSeen ? `Last seen ${lastSeen}` : "Tap to check again";
  } else if (state === "none") {
    title = "No desktop connected";
    detail = "Tap to check again";
  } else {
    title = "Desktop connection unavailable";
    detail = lastSeen ? `Last seen ${lastSeen}` : "Tap to check again";
  }

  return (
    <button
      type="button"
      className={className}
      data-status={state}
      aria-label={`${title}. ${detail}`}
      onClick={() => void refreshDesktopRelayEnvironment()}
      disabled={status === "loading"}
    >
      <span className={dotClassName} aria-hidden="true" />
      <span className={copyClassName}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <RefreshCw size={13} aria-hidden="true" className={iconClassName} />
    </button>
  );
}
