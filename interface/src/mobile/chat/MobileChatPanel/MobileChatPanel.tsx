import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ChatPanel, type ChatPanelProps } from "../../../apps/chat/components/ChatPanel";
import { MobileChatHeader } from "../MobileChatHeader";
import { MobileChatInputBar } from "../MobileChatInputBar";
import styles from "./MobileChatPanel.module.css";

type MobileHeaderSummaryKind = "details" | "switch";

export interface MobileChatPanelProps extends ChatPanelProps {
  mobileHeaderAction?: ReactNode;
  onMobileHeaderSummaryClick?: () => void;
  mobileHeaderSummaryTo?: string;
  mobileHeaderSummaryHint?: string;
  mobileHeaderSummaryLabel?: string;
  mobileHeaderSummaryKind?: MobileHeaderSummaryKind;
}

export function MobileChatPanel({
  mobileHeaderAction,
  onMobileHeaderSummaryClick,
  mobileHeaderSummaryTo,
  mobileHeaderSummaryHint,
  mobileHeaderSummaryLabel,
  mobileHeaderSummaryKind = "details",
  ...props
}: MobileChatPanelProps) {
  const location = useLocation();
  const standaloneDetailsTo = buildStandaloneAgentDetailsLocation(
    location.pathname,
    location.search,
  );
  const resolvedSummaryTo = mobileHeaderSummaryTo
    ?? (onMobileHeaderSummaryClick ? undefined : standaloneDetailsTo);
  const resolvedHeaderAction = mobileHeaderAction
    ?? (onMobileHeaderSummaryClick && standaloneDetailsTo ? (
      <Link
        to={standaloneDetailsTo}
        className={styles.detailsAction}
        aria-label={`Open details for ${props.agentName ?? "agent"}`}
        title="Agent details"
      >
        <Settings2 size={18} aria-hidden="true" />
      </Link>
    ) : undefined);

  return (
    <ChatPanel
      {...props}
      InputBarComponent={MobileChatInputBar}
      header={
        <>
          {props.agentName ? (
            <MobileChatHeader
              agentName={props.agentName}
              machineType={props.machineType}
              action={resolvedHeaderAction}
              onSummaryClick={onMobileHeaderSummaryClick}
              summaryTo={resolvedSummaryTo}
              summaryHint={mobileHeaderSummaryHint}
              summaryLabel={mobileHeaderSummaryLabel}
              summaryKind={mobileHeaderSummaryKind}
            />
          ) : null}
          {props.header}
        </>
      }
    />
  );
}

function buildStandaloneAgentDetailsLocation(
  pathname: string,
  search: string,
): string | undefined {
  if (!/^\/agents\/[^/]+$/.test(pathname)) return undefined;
  const params = new URLSearchParams(search);
  params.set("view", "details");
  return `${pathname}?${params.toString()}`;
}
