import type { ReactNode } from "react";
import { ChatPanel, type ChatPanelProps } from "../../../apps/chat/components/ChatPanel";
import { MobileChatHeader } from "../MobileChatHeader";
import { MobileChatInputBar } from "../MobileChatInputBar";

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
  return (
    <ChatPanel
      {...props}
      InputBarComponent={MobileChatInputBar}
      header={
        props.agentName ? (
          <MobileChatHeader
            agentName={props.agentName}
            machineType={props.machineType}
            action={mobileHeaderAction}
            onSummaryClick={onMobileHeaderSummaryClick}
            summaryTo={mobileHeaderSummaryTo}
            summaryHint={mobileHeaderSummaryHint}
            summaryLabel={mobileHeaderSummaryLabel}
            summaryKind={mobileHeaderSummaryKind}
          />
        ) : null
      }
    />
  );
}
