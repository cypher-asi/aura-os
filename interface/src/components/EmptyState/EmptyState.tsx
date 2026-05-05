import type { ReactNode } from "react";
import { Text } from "@cypher-asi/zui";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function EmptyState({ icon, children, className }: EmptyStateProps) {
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`} data-agent-empty-state="true">
      {icon && <div className={styles.icon}>{icon}</div>}
      <Text variant="muted" size="sm">{children}</Text>
    </div>
  );
}
