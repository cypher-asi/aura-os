import type { ReactNode } from "react";
import { Lane } from "../../../components/Lane";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { ImageGeneration } from "../ImageGeneration";
import { ModelGeneration } from "../ModelGeneration";
import styles from "./Aura3DMainPanel.module.css";

export function Aura3DMainPanel({ children: _children }: { children?: ReactNode }) {
  const error = useAura3DStore((s) => s.error);
  const clearError = useAura3DStore((s) => s.clearError);

  return (
    <Lane flex>
      <div className={styles.container}>
        {error && (
          <div className={styles.errorBanner}>
            <span className={styles.errorText}>{error}</span>
            <button type="button" className={styles.errorDismiss} onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        <div className={styles.sections}>
          <div className={styles.imageSection}>
            <ImageGeneration />
          </div>
          <div className={styles.modelSection}>
            <ModelGeneration />
          </div>
        </div>
      </div>
    </Lane>
  );
}
