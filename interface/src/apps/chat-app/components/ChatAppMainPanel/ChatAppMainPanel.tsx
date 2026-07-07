import { useEffect, type ReactNode } from "react";
import { useAppUIStore } from "../../../../stores/app-ui-store";
import { ProjectFolderPrompt } from "../ProjectFolderPrompt";
import styles from "./ChatAppMainPanel.module.css";

const FIRST_VISIT_KEY = "aura-chat-app:visited";

/**
 * Collapse the sidekick the very first time the user opens the Chat
 * app. Subsequent visits respect whatever the user last toggled via
 * the titlebar button. Implemented in localStorage rather than the
 * zustand store so the "first visit" semantics survive cold reloads.
 */
function useFirstVisitCollapseSidekick(): void {
  useEffect(() => {
    try {
      if (localStorage.getItem(FIRST_VISIT_KEY)) return;
      localStorage.setItem(FIRST_VISIT_KEY, "1");
      useAppUIStore.setState({ sidekickCollapsed: true });
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);
}

/**
 * Wraps the active route element in the persistent flex column the
 * shared `ResponsiveMainLane` expects. The wrapper carries
 * `data-agent-surface` so changelog / capture automation can target
 * the Chat app cleanly.
 *
 * Mounting (rather than the route itself) is the right place to drive
 * the first-visit sidekick collapse: the `MainPanel` sticks around
 * across `?session=` URL flips and back/forward navigation within
 * `/chat`, so we run the effect exactly once per app session instead
 * of on every route remount.
 */
export function ChatAppMainPanel({ children }: { children?: ReactNode }) {
  useFirstVisitCollapseSidekick();
  return (
    <div
      className={styles.surface}
      data-agent-surface="chat-app-chat-panel"
      data-agent-context="chat-app-product-context"
    >
      <ProjectFolderPrompt />
      {children}
    </div>
  );
}
