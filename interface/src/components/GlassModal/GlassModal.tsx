import type { ReactNode } from "react";
import { Modal, type ModalSize } from "@cypher-asi/zui";
import { X } from "lucide-react";
import styles from "./GlassModal.module.css";

interface GlassModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Accessible dialog title. Also rendered in the glass header unless `showHeader` is false. */
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly size?: ModalSize;
  /** Render the soft glow behind the surface. Defaults to true. */
  readonly glow?: boolean;
  /** Render the glass header row with title + close. Defaults to true. */
  readonly showHeader?: boolean;
  /** Extra class on the glass surface (e.g. to set `--glass-modal-glow`). */
  readonly className?: string;
  /** Extra class on the outer modal box, used for sizing. */
  readonly modalClassName?: string;
}

/**
 * Reusable black-glass modal: a transparent zui `Modal` shell wrapping a
 * rounded, blurred, softly glowing glass surface. Generalizes the shell trick
 * from `InviteModal` so any centered modal can adopt the public-page glass look.
 *
 * The blur lives on an inner clipped layer so the rounded corners are preserved
 * (a `backdrop-filter` on the rounded box itself renders square in Chromium).
 */
export function GlassModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  headerActions,
  size = "lg",
  glow = true,
  showHeader = true,
  className,
  modalClassName,
}: GlassModalProps): React.ReactElement | null {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size={size}
      noPadding
      fullHeight
      className={`${styles.box} ${modalClassName ?? ""}`}
      contentClassName={styles.content}
      headerClassName={styles.hiddenHeader}
    >
      <div className={`${styles.surface} ${glow ? styles.glow : ""} ${className ?? ""}`}>
        <div className={styles.clip}>
          <div className={styles.glass} aria-hidden="true" />
          <div className={styles.inner}>
            {showHeader ? (
              <div className={styles.header}>
                <div className={styles.titleGroup}>
                  <span className={styles.title}>{title}</span>
                  {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
                </div>
                <div className={styles.headerRight}>
                  {headerActions}
                  <button
                    type="button"
                    className={styles.close}
                    onClick={onClose}
                    aria-label="Close"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
            <div className={styles.body}>{children}</div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </div>
        </div>
        <div className={styles.border} aria-hidden="true" />
      </div>
    </Modal>
  );
}
