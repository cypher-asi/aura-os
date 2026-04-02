import type { ReactNode } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { ArrowLeft, X } from "lucide-react";
import styles from "./PreviewOverlay.module.css";

interface PreviewOverlayProps {
  title: string;
  canGoBack?: boolean;
  onBack?: () => void;
  onClose: () => void;
  /** Optional action buttons rendered between title and close button */
  actions?: ReactNode;
  children: ReactNode;
}

export function PreviewOverlay({
  title,
  canGoBack = false,
  onBack,
  onClose,
  actions,
  children,
}: PreviewOverlayProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        {canGoBack && onBack && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<ArrowLeft size={14} />}
            aria-label="Back"
            onClick={onBack}
          />
        )}
        <Text size="sm" className={styles.title}>
          {title}
        </Text>
        {actions}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<X size={14} />}
          aria-label="Close"
          onClick={onClose}
        />
      </div>
      <div className={styles.body}>
        {children}
      </div>
    </div>
  );
}
