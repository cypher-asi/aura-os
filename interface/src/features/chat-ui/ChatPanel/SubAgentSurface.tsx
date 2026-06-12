import { type AnimationEventHandler, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ChatSurface } from "./ChatSurface";
import { SubAgentPaneHeader } from "./SubAgentPaneHeader";
import { useSubagentChatStream } from "../../../hooks/use-subagent-chat-stream";
import { useStreamEvents, useIsStreaming } from "../../../hooks/stream/hooks";
import type { ChatInputBarHandle, ChatInputBarProps } from "../ChatInputBar";
import type { SubAgentPaneDescriptor } from "../../../stores/subagent-pane-store";
import type { Project } from "../../../shared/types";
import type { ContextUsageEntry } from "../../../stores/context-usage-store";

const SUBAGENT_UNAVAILABLE_MESSAGE =
  "This subagent thread is no longer available. Its live transcript was cleaned up after the run finished.";

export interface SubAgentSurfaceProps {
  /** The pane to render. Kept rendered through the slide-out by the coordinator. */
  descriptor: SubAgentPaneDescriptor;
  /** Parent agent name, shown as the breadcrumb root in the header. */
  agentName?: string;
  /** Pop the sub-pane and return to the parent thread. */
  onBack: () => void;
  /** Slide-over positioning + animation classes from the coordinator. */
  className?: string;
  /** Lets the coordinator unmount the layer once the slide-out finishes. */
  onAnimationEnd?: AnimationEventHandler<HTMLDivElement>;
  // Passthrough surface props shared with the parent thread.
  adapterType?: string;
  defaultModel?: string | null;
  agentId?: string;
  templateAgentId?: string;
  machineType?: "local" | "remote";
  projects?: Project[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  workspacePath?: string;
  remoteAgentId?: string;
  contextUsage?: ContextUsageEntry;
  InputBarComponent?: ForwardRefExoticComponent<
    ChatInputBarProps & RefAttributes<ChatInputBarHandle>
  >;
}

/**
 * Slide-over layer that streams one subagent thread. Owns the
 * `useSubagentChatStream` attach lifecycle (mounted only while a pane is
 * visible or animating out) and renders a `ChatSurface` retargeted at
 * the child run, with an iOS-style push-navigation header on top.
 */
export function SubAgentSurface({
  descriptor,
  agentName,
  onBack,
  className,
  onAnimationEnd,
  adapterType,
  defaultModel,
  agentId,
  templateAgentId,
  machineType,
  projects,
  selectedProjectId,
  onProjectChange,
  workspacePath,
  remoteAgentId,
  contextUsage,
  InputBarComponent,
}: SubAgentSurfaceProps) {
  const subagentThread = useSubagentChatStream(
    descriptor.childRunId,
    descriptor.parentToolUseId,
    true,
    descriptor.subagentSessionId,
    // Parent agent id so a remote (swarm) parent's child run attaches over
    // the matching harness transport (server `?agent_id=`); local parents
    // pass `undefined` and the server defaults to the local harness.
    agentId,
  );
  const subStreamKey = subagentThread.streamKey;
  const subEvents = useStreamEvents(subStreamKey);
  const subIsStreaming = useIsStreaming(subStreamKey);
  const subHasTranscript = subEvents.length > 0;
  const subConnecting =
    subagentThread.status === "attaching" && !subHasTranscript && !subIsStreaming;
  const subUnavailable =
    subagentThread.status === "error" && !subHasTranscript;

  return (
    <ChatSurface
      className={className}
      onAnimationEnd={onAnimationEnd}
      header={
        <SubAgentPaneHeader
          agentName={agentName}
          subagentType={descriptor.subagentType}
          state={descriptor.state}
          reason={descriptor.reason}
          onBack={onBack}
        />
      }
      streamKey={subStreamKey}
      transcriptKey={subStreamKey}
      onSend={subagentThread.onSend}
      onStop={subagentThread.onStop}
      historyResolved
      isLoading={subConnecting}
      errorMessage={subUnavailable ? SUBAGENT_UNAVAILABLE_MESSAGE : null}
      scrollResetKey={subStreamKey}
      centerInputWhenEmpty={false}
      agentName={agentName}
      machineType={machineType}
      adapterType={adapterType}
      defaultModel={defaultModel}
      templateAgentId={templateAgentId}
      agentId={agentId}
      projects={projects}
      selectedProjectId={selectedProjectId}
      onProjectChange={onProjectChange}
      workspacePath={workspacePath}
      remoteAgentId={remoteAgentId}
      contextUsage={contextUsage}
      InputBarComponent={InputBarComponent}
    />
  );
}
