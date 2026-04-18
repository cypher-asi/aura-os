import type { ReactNode } from "react";
import { useRef } from "react";
import { Lane } from "../../../components/Lane";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import styles from "./IntegrationsMainPanel.module.css";

interface Props {
  children?: ReactNode;
}

/**
 * Chrome around the active `/integrations` route. Mirrors the feedback main
 * panel shape (centered content column inside a scrollable lane) so the app
 * visually fits in with the rest of the shell.
 */
export function IntegrationsMainPanel({ children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Lane flex>
      <div className={styles.container}>
        <div ref={scrollRef} className={styles.scrollArea}>
          <div className={styles.content}>{children}</div>
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
    </Lane>
  );
}
