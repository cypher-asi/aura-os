import type { ReactNode } from "react";
import { useRef } from "react";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import styles from "./IntegrationsMainPanel.module.css";

interface Props {
  children?: ReactNode;
}

/**
 * Chrome around the active `/integrations` route. Mirrors the feedback main
 * panel shape (centered content column inside a scrollable lane) so the app
 * visually fits in with the rest of the shell. The shell now provides the
 * outer `ResponsiveMainLane`, so this component only renders inner chrome.
 */
export function IntegrationsMainPanel({ children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.container}>
      <div ref={scrollRef} className={styles.scrollArea}>
        <div className={styles.content}>{children}</div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
