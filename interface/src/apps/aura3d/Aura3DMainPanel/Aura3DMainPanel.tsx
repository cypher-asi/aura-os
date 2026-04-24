import type { ReactNode } from "react";
import { Tabs } from "@cypher-asi/zui";
import { Lane } from "../../../components/Lane";
import { useAura3DStore, type Aura3DTab } from "../../../stores/aura3d-store";
import { ImageGeneration } from "../ImageGeneration";
import { ModelGeneration } from "../ModelGeneration";
import styles from "./Aura3DMainPanel.module.css";

const TABS = [
  { id: "image" as const, label: "Image" },
  { id: "3d" as const, label: "3D Model" },
];

export function Aura3DMainPanel({ children: _children }: { children?: ReactNode }) {
  const activeTab = useAura3DStore((s) => s.activeTab);
  const setActiveTab = useAura3DStore((s) => s.setActiveTab);
  const error = useAura3DStore((s) => s.error);
  const clearError = useAura3DStore((s) => s.clearError);

  return (
    <Lane flex>
      <div className={styles.container}>
        <div className={styles.tabBar}>
          <Tabs
            tabs={TABS}
            value={activeTab}
            onChange={(id) => setActiveTab(id as Aura3DTab)}
            size="sm"
          />
        </div>
        {error && (
          <div className={styles.errorBanner}>
            <span className={styles.errorText}>{error}</span>
            <button type="button" className={styles.errorDismiss} onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        <div className={styles.tabContent}>
          {activeTab === "image" && <ImageGeneration />}
          {activeTab === "3d" && <ModelGeneration />}
        </div>
      </div>
    </Lane>
  );
}
