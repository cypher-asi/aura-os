import { memo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { ModeSelector } from "../../../../components/InputBarShell";
import type { AgentMode } from "../../../../constants/modes";
import styles from "./ChatModeBar.module.css";

export interface ChatModeBarProps {
  selectedMode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  /**
   * Demo/static surfaces drive the visible selector locally instead of
   * the store; when set, explicit picks (including re-clicks on the
   * active mode) route here.
   */
  onModeSelect?: (mode: AgentMode) => void;
  modeLabels?: Partial<Record<AgentMode, string>>;
  /**
   * When provided, the bar renders as a tab row with a collapse chevron
   * and a "+" new-chat button; when omitted it renders the detached
   * standalone selector.
   */
  onNewChat?: () => void;
}

/**
 * The agent MODE row above the input pill: Code / Plan / Image / Video /
 * 3D pills, plus (on chat surfaces with a new-chat affordance) the
 * collapse chevron and the "+" new-chat button.
 */
export const ChatModeBar = memo(function ChatModeBar({
  selectedMode,
  onModeChange,
  onModeSelect,
  modeLabels,
  onNewChat,
}: ChatModeBarProps) {
  // Collapses the mode-selector pills, leaving the balanced chevron
  // (left) / new-chat "+" (right) affordances in place.
  const [modesCollapsed, setModesCollapsed] = useState(false);

  if (!onNewChat) {
    return (
      <ModeSelector
        selectedMode={selectedMode}
        onChange={onModeChange}
        onSelect={onModeSelect}
        labels={modeLabels}
        className={styles.modeSelectorDetached}
      />
    );
  }

  return (
    <div className={styles.modeBarRow}>
      <button
        type="button"
        className={styles.modeCollapseButton}
        onClick={() => setModesCollapsed((v) => !v)}
        title={modesCollapsed ? "Show modes" : "Hide modes"}
        aria-label={modesCollapsed ? "Show modes" : "Hide modes"}
        aria-expanded={!modesCollapsed}
        data-agent-action="toggle-modes"
      >
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          className={
            modesCollapsed
              ? `${styles.modeChevron} ${styles.modeChevronCollapsed}`
              : styles.modeChevron
          }
        />
      </button>
      {modesCollapsed ? null : (
        <ModeSelector
          selectedMode={selectedMode}
          onChange={onModeChange}
          onSelect={onModeSelect}
          labels={modeLabels}
          className={styles.modeSelectorFlex}
        />
      )}
      <button
        type="button"
        className={styles.modeNewChatButton}
        onClick={onNewChat}
        title="Start a new chat"
        aria-label="Start new chat"
        data-agent-action="start-new-chat"
      >
        {/* Match the bottom-left attach button's glyph so both `+`
            affordances on the LLM input are visually identical. */}
        <Plus size={16} strokeWidth={1} />
      </button>
    </div>
  );
});
