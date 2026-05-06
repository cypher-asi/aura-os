import { memo, useMemo } from "react";
import { FileText } from "lucide-react";
import type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplaySessionEvent,
} from "../../../../shared/types/stream";
import { langFromPath } from "../../../../ide/lang";
import { useHighlightedHtml } from "../../../../shared/hooks/use-highlighted-html";
import { useUIModalStore } from "../../../../stores/ui-modal-store";
import styles from "./MessageBubble.module.css";
import { ResponseBlock } from "../../../../components/ResponseBlock";
import { CopyButton } from "../../../../components/CopyButton";
import { useGallery, type GalleryItem } from "../../../../components/Gallery";
import { LLMOutput } from "../LLMOutput";
import { LargeTextBlock, isLargeText } from "./LargeTextBlock";

interface Props {
  message: DisplaySessionEvent;
  isStreaming?: boolean;
  initialThinkingExpanded?: boolean;
  initialActivitiesExpanded?: boolean;
}

const FILE_PREFIX_RE = /^\[File:\s*(.+?)\]\n\n([\s\S]*)$/;

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
  initialThinkingExpanded,
  initialActivitiesExpanded,
}: Props) {
  const openBuyCredits = useUIModalStore((state) => state.openBuyCredits);
  const { openGallery } = useGallery();
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
  const { imageBlocks, nonImageBlocks } = useMemo(() => {
    const images: { block: DisplayImageBlock; index: number }[] = [];
    const others: { block: DisplayContentBlock; index: number }[] = [];
    if (hasContentBlocks && message.contentBlocks) {
      message.contentBlocks.forEach((block, index) => {
        if (block.type === "image") {
          images.push({ block, index });
        } else {
          others.push({ block, index });
        }
      });
    }
    return { imageBlocks: images, nonImageBlocks: others };
  }, [hasContentBlocks, message.contentBlocks]);

  const galleryImages = useMemo<GalleryItem[]>(() => {
    return imageBlocks.map(({ block, index }) => ({
      id: `${message.id}-img-${index}`,
      src: `data:${block.media_type};base64,${block.data}`,
      alt: "Attached image",
    }));
  }, [imageBlocks, message.id]);
  // Models sometimes emit an empty text block right before a tool_use; that
  // still leaves contentBlocks non-empty but nothing renderable, so ignore
  // whitespace-only text blocks when deciding if the bubble carries prose.
  const hasRenderableBlocks = (message.contentBlocks ?? []).some(
    (b) => b.type === "image" || (b.type === "text" && b.text.trim().length > 0),
  );
  // A tool-only assistant bubble holds no prose/thinking -- it is just a
  // slice of the agent's tool-use loop. Drop the bubble padding for these
  // so consecutive tool-only bubbles stack as a tight checklist instead of
  // each row floating in its own 16px padding box. Stream-dropped bubbles
  // own their own banner chrome and must not be collapsed into the compact
  // tool-only slot.
  const isAssistantToolOnly =
    message.role === "assistant"
    && !isInsufficientCreditsError
    && !isStreamDropped
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

  if (!hasContent && !hasToolCalls && !hasContentBlocks && !hasThinking && !hasArtifactRefs) return null;

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
            return <span key={index}>{block.text}</span>;
          })}
        </div>
      );
    }
    if (hasContent && isLargeText(message.content)) {
      return <LargeTextBlock text={message.content} />;
    }
    return message.content;
  };

  const renderAssistantContent = () => {
    if (isStreamDropped) {
      return (
        <div
          className={styles.streamDroppedBanner}
          role="status"
          aria-live="polite"
        >
          <span className={styles.streamDroppedTitle}>
            Chat stream interrupted
          </span>
          <span className={styles.streamDroppedMessage}>{message.content}</span>
          {(hasToolCalls || hasThinking || hasArtifactRefs || hasTimeline) && (
            <div className={styles.streamDroppedMeta}>
              <LLMOutput
                content=""
                timeline={message.timeline}
                toolCalls={message.toolCalls}
                thinkingText={message.thinkingText}
                thinkingDurationMs={message.thinkingDurationMs}
                artifactRefs={message.artifactRefs}
                isStreaming={isStreaming}
                defaultThinkingExpanded={initialThinkingExpanded}
                defaultActivitiesExpanded={initialActivitiesExpanded}
              />
            </div>
          )}
        </div>
      );
    }

    if (!isInsufficientCreditsError) {
      return (
        <LLMOutput
          content={message.content}
          timeline={message.timeline}
          toolCalls={message.toolCalls}
          thinkingText={message.thinkingText}
          thinkingDurationMs={message.thinkingDurationMs}
          artifactRefs={message.artifactRefs}
          isStreaming={isStreaming}
          defaultThinkingExpanded={initialThinkingExpanded}
          defaultActivitiesExpanded={initialActivitiesExpanded}
        />
      );
    }

    return (
      <div className={styles.inlineError}>
        <span className={styles.inlineErrorMessage}>{message.content}</span>
        <button
          type="button"
          className={styles.inlineErrorLink}
          onClick={openBuyCredits}
        >
          Buy credits
        </button>
        {(hasToolCalls || hasThinking || hasArtifactRefs || hasTimeline) && (
          <div className={styles.inlineErrorMeta}>
            <LLMOutput
              content=""
              timeline={message.timeline}
              toolCalls={message.toolCalls}
              thinkingText={message.thinkingText}
              thinkingDurationMs={message.thinkingDurationMs}
              artifactRefs={message.artifactRefs}
              isStreaming={isStreaming}
              defaultThinkingExpanded={initialThinkingExpanded}
              defaultActivitiesExpanded={initialActivitiesExpanded}
            />
          </div>
        )}
      </div>
    );
  };

  const isUser = message.role === "user";
  const hasUserImages = isUser && imageBlocks.length > 0;
  // For user messages we suppress the dark text bubble entirely when the
  // message is image-only -- the image strip becomes the message itself.
  // When contentBlocks isn't used (legacy plain-text path) we always show
  // the bubble. Assistant rendering is unaffected.
  const renderUserBubble =
    isUser && (!hasContentBlocks || nonImageBlocks.length > 0);
  const renderBubble = isUser ? renderUserBubble : true;

  return (
    <div
      className={`${styles.message} ${
        isUser ? styles.messageUser : styles.messageAssistant
      } ${userBlocksAreAllWidgets ? styles.messageUserWidgetOnly : ""}`}
    >
      {hasUserImages && (
        <div className={styles.userImageStrip}>
          {imageBlocks.map(({ block, index }) => (
            <button
              key={index}
              type="button"
              className={styles.messageImageWrapper}
              onClick={() => {
                if (galleryImages.length === 0) return;
                openGallery({
                  items: galleryImages,
                  initialId: `${message.id}-img-${index}`,
                });
              }}
              aria-label="Open image in gallery"
            >
              <img
                src={`data:${block.media_type};base64,${block.data}`}
                alt=""
                className={styles.messageImage}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {renderBubble && (
        <div
          className={`${styles.bubble} ${
            isUser ? styles.bubbleUser : styles.bubbleAssistant
          } ${isAssistantToolOnly ? styles.bubbleAssistantCompact : ""} ${
            userBlocksAreAllWidgets ? styles.bubbleUserWidgetOnly : ""
          }`}
        >
          {isUser ? renderUserContent() : renderAssistantContent()}
        </div>
      )}
    </div>
  );
});
