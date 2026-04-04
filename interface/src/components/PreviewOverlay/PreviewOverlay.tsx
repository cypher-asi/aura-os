import { useRef, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Text, cn } from "@cypher-asi/zui";
import { ArrowLeft, X } from "lucide-react";
import styles from "./PreviewOverlay.module.css";

interface PreviewOverlayProps {
  title: string;
  canGoBack?: boolean;
  onBack?: () => void;
  onClose: () => void;
  /** Optional action buttons rendered between title and close button */
  actions?: ReactNode;
  /** Portal overlay to the nearest Lane so it covers the full sidekick (header included). */
  fullLane?: boolean;
  children: ReactNode;
}

export function PreviewOverlay({
  title,
  canGoBack = false,
  onBack,
  onClose,
  actions,
  fullLane = false,
  children,
}: PreviewOverlayProps) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (fullLane && markerRef.current) {
      const lane = markerRef.current.closest("[data-lane]") as HTMLElement | null;
      if (lane) setPortalTarget(lane);
    }
  }, [fullLane]);

  const overlay = (
    <div className={cn(styles.overlay, fullLane && styles.fullLane)}>
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

  if (fullLane && portalTarget) {
    return (
      <>
        <div ref={markerRef} style={{ display: "none" }} />
        {createPortal(overlay, portalTarget)}
      </>
    );
  }

  if (fullLane) {
    return (
      <>
        <div ref={markerRef} style={{ display: "none" }} />
        {overlay}
      </>
    );
  }

  return overlay;
}
