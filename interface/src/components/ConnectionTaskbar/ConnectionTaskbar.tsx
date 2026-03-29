import type { ReactNode } from "react";
import { ConnectionDot } from "../ConnectionDot";
import styles from "./ConnectionTaskbar.module.css";

export function ConnectionTaskbar({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.taskbar}>
      <div className={styles.status}>
        <ConnectionDot />
      </div>
      {children}
    </div>
  );
}
