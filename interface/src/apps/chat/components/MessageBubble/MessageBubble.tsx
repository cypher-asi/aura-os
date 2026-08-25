import { Suspense, lazy, memo, useCallback, useMemo, useRef } from "react";
import { CornerDownLeft, FileText } from "lucide-react";
import type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplayModel3DBlock,
  DisplaySessionEvent,
  DisplayVideoBlock,
} from "../../../../shared/types/stream";
import { useAgentStore } from "../../../agents/stores/agent-store";

const WebGLViewer = lazy(() =>
  import("../../../aura3d/WebGLViewer/WebGLViewer").then((m) => ({
    default: m.WebGLViewer,
  })),
);

/** Resolve an image block to a renderable src URL. Prefers source_url (S3) over inline base64. */
function imageBlockSrc(block: DisplayImageBlock): string {
  if (block.source_url) return block.source_url;
  return `data:${block.media_type};base64,${block.data}`;
}
import { langFromPath } from "../../../../ide/lang";
import { useHighlightedHtml } from "../../../../shared/hooks/use-highlighted-html";
import { useUIModalStore } from "../../../../stores/ui-modal-store";
import styles from "./MessageBubble.module.css";
import { ResponseBlock } from "../../../../components/ResponseBlock";
import { CopyButton } from "../../../../components/CopyButton";
import { FadeInImage } from "../../../../components/FadeInImage";
import { GeneratedImageFrame } from "../../../../components/GeneratedImageFrame";
import {
  useGallery,
  useSessionGalleryItems,
  type GalleryItem,
} from "../../../../components/Gallery";
import { LLMOutput } from "../LLMOutput";
import { LargeTextBlock, isLargeText } from "./LargeTextBlock";
import { ReportBugButton } from "../../../../components/ReportBugButton";
import { MessageActions } from "../MessageActions";
import { useMarkdownCopy } from "../../../../shared/hooks/use-markdown-copy";
import {
  type ErrorReportAgentInfo,
  formatErrorReportAgentInfo,
} from "../../../../hooks/use-error-report-agent-info";

interface Props {
  message: DisplaySessionEvent;
  isStreaming?: boolean;
  initialActivitiesExpanded?: boolean;
  /**
   * Phase 5: stream key the message belongs to. Threaded into the
   * inline `ReportBugButton` rendered on error variants so the
   * pre-filled bundle filters the breadcrumb ring down to this
   * stream's recent activity. Optional because not every render
   * site has it (e.g. the historical-message preview surfaces).
   */
  streamKey?: string;
  /** Phase 5: optional agent id forwarded to the inline `ReportBugButton`. */
  agentId?: string;
  /** Phase 5: optional session id forwarded to the inline `ReportBugButton`. */
  sessionId?: string;
  /**
   * Agent identity + device context shown on, and copied with, every
   * error variant so a user-shared failure carries the agent name,
   * local/remote type, status, and device. Optional because read-only
   * / historical surfaces don't resolve it.
   */
  errorAgentInfo?: ErrorReportAgentInfo;
  /**
   * Resend the most-recent prompt for this stream. When provided, error
   * bubbles (server busy / agent busy / generic stream errors) render a
   * manual "Retry" button. Omitted on read-only/historical surfaces, where
   * the button does not render. The insufficient-credits variant never
   * shows Retry — it keeps its "Buy credits" action instead.
   */
  onRetry?: () => void;
}

const FILE_PREFIX_RE = /^\[File:\s*(.+?)\]\n\n([\s\S]*)$/;

/**
 * Render-friendly fallback when the local `useAgentStore` doesn't
 * carry a name for the sender (typically because the sending agent
 * lives in another org the user has never opened). UUID prefix +
 * ellipsis keeps the badge compact while preserving enough of the
 * id for an operator to disambiguate by hand. Empty string in →
 * empty string out so callers can guard with the same `senderLabel`
 * truthiness check.
 */
function truncateAgentId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}

function FileAttachmentBlock({ text }: { text: string }) {
  const match = text.match(FILE_PREFIX_RE);
  const fileName = match?.[1] ?? "";
  const fileContents = match?.[2] ?? "";
  const language = langFromPath(fileName);
  const highlightedHtml = useHighlightedHtml(fileContents, language);

  if (!match) return <span>{text}</span>;

  return (
    <div className={styles.fileAttachmentWrapper}>
      <ResponseBlock
        header={
          <>
            <FileText size={14} className={styles.fileAttachmentIcon} />
            <span className={styles.fileAttachmentName}>{fileName}</span>
          </>
        }
        className={styles.fileAttachmentBlock}
        contentClassName={styles.fileAttachmentContent}
      >
        <pre>
          <code
            className={language ? `hljs language-${language}` : "hljs"}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </ResponseBlock>
      <CopyButton
        getText={() => fileContents}
        className={styles.fileAttachmentCopyBtn}
        ariaLabel={`Copy ${fileName || "file"} contents`}
      />
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  initialActivitiesExpanded,
  streamKey,
  agentId,
  sessionId,
  errorAgentInfo,
  onRetry,
}: Props) {
  const openBuyCredits = useUIModalStore((state) => state.openBuyCredits);
  const { openGallery } = useGallery();
  // Session-wide list published by `ChatMessageList`. When present we
  // open the lightbox with every image in the conversation so the user
  // can page forward/back across messages; when absent (isolated
  // tests, non-chat surfaces) we degrade to the per-bubble list.
  const sessionGalleryItems = useSessionGalleryItems();
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasArtifactRefs = message.artifactRefs && message.artifactRefs.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasThinking = message.thinkingText && message.thinkingText.length > 0;
  const hasTimeline = message.timeline && message.timeline.length > 0;
  const isInsufficientCreditsError = message.displayVariant === "insufficientCreditsError";
  const isStreamDropped = message.displayVariant === "streamDropped";

  // Track image vs non-image blocks separately so user attachments render as
  // their own thumbnail strip *above* the dark text bubble instead of being
  // crammed into the same padded card. We keep the original `contentBlocks`
  // index alongside each entry so gallery ids stay stable (`<msgId>-img-<i>`)
  // regardless of how we split or filter for rendering.
  const { imageBlocks, videoBlocks, model3dBlocks, nonImageBlocks } = useMemo(() => {
    const images: { block: DisplayImageBlock; index: number }[] = [];
    const videos: { block: DisplayVideoBlock; index: number }[] = [];
    const models: { block: DisplayModel3DBlock; index: number }[] = [];
    const others: { block: DisplayContentBlock; index: number }[] = [];
    if (hasContentBlocks && message.contentBlocks) {
      message.contentBlocks.forEach((block, index) => {
        if (block.type === "image") {
          images.push({ block, index });
        } else if (block.type === "video") {
          videos.push({ block, index });
        } else if (block.type === "model3d") {
          models.push({ block, index });
        } else {
          others.push({ block, index });
        }
      });
    }
    return { imageBlocks: images, videoBlocks: videos, model3dBlocks: models, nonImageBlocks: others };
  }, [hasContentBlocks, message.contentBlocks]);

  const galleryImages = useMemo<GalleryItem[]>(() => {
    return imageBlocks.map(({ block, index }) => ({
      id: `${message.id}-img-${index}`,
      src: imageBlockSrc(block),
      alt: "Attached image",
    }));
  }, [imageBlocks, message.id]);
  // Models sometimes emit an empty text block right before a tool_use; that
  // still leaves contentBlocks non-empty but nothing renderable, so ignore
  // whitespace-only text blocks when deciding if the bubble carries prose.
  const hasRenderableBlocks = (message.contentBlocks ?? []).some(
    (b) => b.type === "image" || b.type === "video" || b.type === "model3d" || (b.type === "text" && b.text.trim().length > 0),
  );
  // A tool-only assistant bubble holds no prose/thinking -- it is just a
  // slice of the agent's tool-use loop. Drop the bubble padding for these
  // so consecutive tool-only bubbles stack as a tight checklist instead of
  // each row floating in its own 16px padding box. Stream-dropped and
  // other error bubbles own their own chrome (banner / action row) and
  // must not be collapsed into the compact tool-only slot.
  const hasInlineErrorActionChrome = !!message.errorMessage
    || !!message.supportId || !!message.displayVariant;
  const isAssistantToolOnly =
    message.role === "assistant"
    && !hasInlineErrorActionChrome
    && !hasContent
    && !hasRenderableBlocks
    && !hasThinking
    && (hasToolCalls || hasTimeline);

  // A user message is "widget-only" when every renderable text block is
  // either a file attachment (`[File: ...]`) or qualifies as a large-text
  // doc. Image blocks now render in their own strip above the bubble, so
  // they don't disqualify the bubble chrome from being dropped around the
  // remaining text/file widgets.
  const userBlocksAreAllWidgets = (() => {
    if (message.role !== "user") return false;
    if (hasContentBlocks && message.contentBlocks) {
      if (nonImageBlocks.length === 0) return false;
      return nonImageBlocks.every(({ block }) => {
        return FILE_PREFIX_RE.test(block.text) || isLargeText(block.text);
      });
    }
    if (hasContent && isLargeText(message.content)) return true;
    return false;
  })();

  // Completed assistant prose gets the bottom action row, and the bubble
  // ref still lets `useMarkdownCopy` intercept OS-level select+copy of
  // the whole bubble so users get markdown source instead of rendered
  // text. Hook calls live above the early `return null` below to keep
  // call order stable across renders.
  const assistantBubbleRef = useRef<HTMLDivElement>(null);
  const showAssistantCopy = !!(
    message.role === "assistant"
    && !isStreaming
    && !isStreamDropped
    && hasContent
    && !isAssistantToolOnly
  );
  const getAssistantMarkdown = useCallback(
    () => message.content ?? "",
    [message.content],
  );
  const noopRef = useRef<HTMLElement>(null);
  useMarkdownCopy(
    showAssistantCopy ? assistantBubbleRef : noopRef,
    getAssistantMarkdown,
  );

  // Error events (handleStreamError) carry the synthesized
  // string in `errorMessage` instead of `content`, so an
  // otherwise-empty error bubble must still render in order to
  // surface the action row. `displayVariant` covers the same
  // case for variants that don't carry a message (none today,
  // but kept for forward compatibility). Reuses the same
  // predicate that suppresses the compact tool-only layout.
  if (
    !hasContent && !hasToolCalls && !hasContentBlocks
    && !hasThinking && !hasArtifactRefs && !hasInlineErrorActionChrome
  ) return null;

  const renderUserContent = () => {
    if (hasContentBlocks && message.contentBlocks) {
      return (
        <div className={styles.userMessageBlocks}>
          {nonImageBlocks.map(({ block, index }) => {
            if (FILE_PREFIX_RE.test(block.text)) {
              return <FileAttachmentBlock key={index} text={block.text} />;
            }
            if (isLargeText(block.text)) {
              return <LargeTextBlock key={index} text={block.text} />;
            }
            return (
              <span key={index} className={styles.userText}>
                {block.text}
              </span>
            );
          })}
        </div>
      );
    }
    if (hasContent && isLargeText(message.content)) {
      return <LargeTextBlock text={message.content} />;
    }
    return <span className={styles.userText}>{message.content}</span>;
  };

  // Shared chrome for every error variant. Renders as two
  // stacked lines below the optional partial streaming buffer /
  // meta block:
  //   line 1: full (wrapping) error message + one-click copy
  //   line 2: Support ID chip and Report bug button (plus the
  //           variant-specific primary action, e.g. "Buy
  //           credits", when applicable)
  // Stacking — rather than the previous single ellipsised row —
  // lets long contract-blocked messages stay fully readable
  // without forcing the user to hover for a `title` tooltip,
  // while keeping the support id + bug-report controls grouped
  // on their own row directly under the message they describe.
  const renderErrorActions = () => {
    if (
      !message.displayVariant
      && !message.supportId
      && !message.errorMessage
    ) {
      return null;
    }
    // Agent + device context appended to the copied error so a shared
    // failure is self-describing. Built once and reused for both the
    // copy payload and the visible meta line below.
    const agentInfoText = formatErrorReportAgentInfo(errorAgentInfo);
    const copyErrorText = () => {
      const base = message.errorMessage ?? "";
      if (!agentInfoText) return base;
      return base ? `${base}\n\n${agentInfoText}` : agentInfoText;
    };
    return (
      <div className={styles.errorChrome}>
        {message.errorMessage && (
          <div className={styles.errorMessageLine}>
            <span className={styles.errorMessageText}>
              {message.errorMessage}
            </span>
            <CopyButton
              getText={copyErrorText}
              ariaLabel="Copy error message"
              iconOnly
              className={styles.errorCopyBtn}
            />
          </div>
        )}
        {errorAgentInfo && (
          <div className={styles.errorAgentMeta}>
            <span className={styles.errorAgentMetaItem}>
              <span className={styles.errorAgentMetaLabel}>Agent</span>
              {errorAgentInfo.name ?? "unknown"} (
              {errorAgentInfo.machineType === "remote" ? "remote" : "local"}
              {errorAgentInfo.status ? `, ${errorAgentInfo.status}` : ""})
            </span>
            <span className={styles.errorAgentMetaItem}>
              <span className={styles.errorAgentMetaLabel}>Device</span>
              {errorAgentInfo.clientDevice}
            </span>
            <span className={styles.errorAgentMetaItem}>
              <span className={styles.errorAgentMetaLabel}>Agent machine</span>
              {errorAgentInfo.agentMachine}
            </span>
            {errorAgentInfo.ip && (
              <span className={styles.errorAgentMetaItem}>
                <span className={styles.errorAgentMetaLabel}>IP</span>
                {errorAgentInfo.ip}
              </span>
            )}
          </div>
        )}
        <div className={styles.errorMetaRow}>
          {onRetry && !isInsufficientCreditsError && (
            <button
              type="button"
              className={styles.inlineErrorLink}
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {isInsufficientCreditsError && (
            <button
              type="button"
              className={styles.inlineErrorLink}
              onClick={openBuyCredits}
            >
              Buy credits
            </button>
          )}
          {message.supportId && (
            <span
              className={styles.supportIdChip}
              title="Server-stamped support id — copy and share with support to join this report to the matching server log entry"
            >
              <span className={styles.supportIdLabel}>Support ID</span>
              <code className={styles.supportIdValue}>{message.supportId}</code>
              <CopyButton
                getText={() => message.supportId ?? ""}
                ariaLabel="Copy support id"
                iconOnly
                className={styles.supportIdCopyBtn}
              />
            </span>
          )}
          <ReportBugButton
            streamKey={streamKey}
            supportId={message.supportId}
            agentId={agentId}
            sessionId={sessionId}
            compact
          />
        </div>
      </div>
    );
  };

  const renderAssistantContent = () => {
    // Partial streaming buffer captured before the turn errored
    // out (or normal assistant content on success). Skipped when
    // empty so an error with no prefix doesn't render an empty
    // markdown frame above the action row.
    const hasRenderableContent = hasContent || hasToolCalls
      || hasThinking || hasArtifactRefs || hasTimeline;

    if (isStreamDropped) {
      // Render any partial content exactly like a successful turn so the
      // interruption notice doesn't swallow the whole message in the
      // warning box. The banner below carries only the "interrupted"
      // notice + recovery actions.
      return (
        <>
          {hasRenderableContent && (
            <LLMOutput
              content={message.content}
              timeline={message.timeline}
              toolCalls={message.toolCalls}
              thinkingText={message.thinkingText}
              thinkingDurationMs={message.thinkingDurationMs}
              artifactRefs={message.artifactRefs}
              isStreaming={isStreaming}
              defaultActivitiesExpanded={initialActivitiesExpanded}
            />
          )}
          <div
            className={styles.streamDroppedBanner}
            role="status"
            aria-live="polite"
          >
            <span className={styles.streamDroppedTitle}>
              Chat stream interrupted
            </span>
            {renderErrorActions()}
          </div>
        </>
      );
    }

    return (
      <>
        {hasRenderableContent && (
          <LLMOutput
            content={message.content}
            timeline={message.timeline}
            toolCalls={message.toolCalls}
            thinkingText={message.thinkingText}
            thinkingDurationMs={message.thinkingDurationMs}
            artifactRefs={message.artifactRefs}
            isStreaming={isStreaming}
            defaultActivitiesExpanded={initialActivitiesExpanded}
          />
        )}
        {renderErrorActions()}
      </>
    );
  };

  const isUser = message.role === "user";
  const hasUserImages = isUser && imageBlocks.length > 0;
  const hasAssistantImages = !isUser && imageBlocks.length > 0;
  // For user messages we suppress the dark text bubble entirely when the
  // message is image-only -- the image strip becomes the message itself.
  // When contentBlocks isn't used (legacy plain-text path) we always show
  // the bubble. Assistant rendering is unaffected.
  const renderUserBubble =
    isUser && (!hasContentBlocks || nonImageBlocks.length > 0);
  // Suppress the assistant text bubble when the message is media-only
  // (image/video/3D with empty text content). The media strips render
  // above the bubble, so an empty bubble just adds dead padding.
  const hasAssistantMediaOnly =
    !isUser &&
    !hasContent &&
    !hasToolCalls &&
    !hasThinking &&
    !hasArtifactRefs &&
    !hasInlineErrorActionChrome &&
    (imageBlocks.length > 0 || videoBlocks.length > 0 || model3dBlocks.length > 0);
  const renderBubble = isUser ? renderUserBubble : !hasAssistantMediaOnly;
  const isUserImageOnly = isUser && hasUserImages && !renderUserBubble;
  // Cross-agent provenance badge. When the persisted user_message
  // carries a `from_agent_id` (set by `parse_user_message_event`
  // server-side for any row injected by another agent — A→B inbound
  // or B→A async reply), surface a small "↩ from <agent>" label
  // above the bubble. Without this, replies posted back into the
  // sender's chat panel by the cross-agent reply callback look
  // indistinguishable from the user's own input — exactly the
  // duplicate-prompt UX bug Fix A was added to close. Resolves the
  // sender's display name from `useAgentStore` (every agent the
  // local org knows about is already cached there); falls back to a
  // truncated id for cross-org senders the local store has never
  // fetched, so the badge always renders something useful.
  const isCrossAgentReply = isUser && !!message.fromAgentId;
  const senderName = useAgentStore((state) =>
    isCrossAgentReply
      ? state.agents.find((a) => a.agent_id === message.fromAgentId)?.name
      : undefined,
  );
  const senderLabel = isCrossAgentReply
    ? senderName?.trim() || truncateAgentId(message.fromAgentId ?? "")
    : null;

  return (
    <div
      className={`${styles.message} ${
        isUser ? styles.messageUser : styles.messageAssistant
      } ${userBlocksAreAllWidgets ? styles.messageUserWidgetOnly : ""} ${
        isUserImageOnly ? styles.messageUserImageOnly : ""
      } ${isCrossAgentReply ? styles.messageUserCrossAgent : ""}`}
    >
      {isCrossAgentReply && senderLabel && (
        <div
          className={styles.crossAgentBadge}
          // Full UUID lives in a tooltip so power users can grab
          // the canonical handle (matches the truncated-id
          // fallback when the agent isn't in the local store).
          title={`Cross-agent reply from agent ${message.fromAgentId}`}
          aria-label={`Cross-agent reply from ${senderLabel}`}
        >
          <CornerDownLeft size={12} className={styles.crossAgentBadgeIcon} />
          <span className={styles.crossAgentBadgeText}>from {senderLabel}</span>
        </div>
      )}
      {hasUserImages && (
        <div className={styles.userImageStrip}>
          {imageBlocks.map(({ block, index }) => (
            <button
              key={index}
              type="button"
              className={styles.messageImageWrapper}
              onClick={() => {
                if (galleryImages.length === 0) return;
                const items =
                  sessionGalleryItems && sessionGalleryItems.length > 0
                    ? sessionGalleryItems
                    : galleryImages;
                openGallery({
                  items,
                  initialId: `${message.id}-img-${index}`,
                });
              }}
              aria-label="Open image in gallery"
            >
              <FadeInImage
                src={imageBlockSrc(block)}
                alt=""
                className={styles.messageImage}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {hasAssistantImages && (
        <div className={styles.generatedImageStrip}>
          {imageBlocks.map(({ block, index }) => (
            <button
              key={index}
              type="button"
              className={styles.generatedImageWrapper}
              onClick={() => {
                if (galleryImages.length === 0) return;
                openGallery({
                  items: galleryImages.map((item) => ({
                    ...item,
                    downloadUrl: item.src,
                  })),
                  initialId: `${message.id}-img-${index}`,
                });
              }}
              aria-label="Open generated image in gallery"
            >
              <GeneratedImageFrame
                src={imageBlockSrc(block)}
                alt="Generated image"
                className={styles.generatedImageInline}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {videoBlocks.length > 0 && (
        <div className={styles.generatedVideoStrip}>
          {videoBlocks.map(({ block, index }) => (
            <div key={index} className={styles.generatedVideoContainer}>
              <video
                src={`${block.url}#t=0.5`}
                className={styles.generatedVideoPlayer}
                controls
                playsInline
                preload="metadata"
              />
              <a
                href={block.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.generatedMediaDownload}
                download
              >
                Download video
              </a>
            </div>
          ))}
        </div>
      )}
      {model3dBlocks.length > 0 && (
        <div className={styles.generatedModel3DStrip}>
          {model3dBlocks.map(({ block, index }) => (
            <div key={index} className={styles.generatedModel3DContainer}>
              <div className={styles.generatedModel3DViewerWrap}>
                <Suspense fallback={<div style={{ height: 400, display: "grid", placeItems: "center", color: "var(--color-text-muted)" }}>Loading 3D viewer…</div>}>
                  <WebGLViewer glbUrl={block.url} showGrid showTexture />
                </Suspense>
              </div>
              <a
                href={block.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.generatedMediaDownload}
                download
              >
                Download 3D model
              </a>
            </div>
          ))}
        </div>
      )}
      {renderBubble && (
        <div
          ref={!isUser ? assistantBubbleRef : undefined}
          className={`${styles.bubble} ${
            isUser ? styles.bubbleUser : styles.bubbleAssistant
          } ${isAssistantToolOnly ? styles.bubbleAssistantCompact : ""} ${
            userBlocksAreAllWidgets ? styles.bubbleUserWidgetOnly : ""
          }`}
        >
          {isUser ? renderUserContent() : renderAssistantContent()}
        </div>
      )}
      {isUser && message.deliveryStatus === "queued" && (
        <div className={styles.deliveryStatus} role="status">
          Queued
        </div>
      )}
      {showAssistantCopy && streamKey && (
        <MessageActions message={message} streamKey={streamKey} />
      )}
    </div>
  );
});
