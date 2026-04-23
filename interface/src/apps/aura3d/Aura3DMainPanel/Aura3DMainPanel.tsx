import type { ReactNode } from "react";
import { Tabs } from "@cypher-asi/zui";
import { Lane } from "../../../components/Lane";
import { useAura3DStore, type Aura3DTab } from "../../../stores/aura3d-store";
import { ImagineTab } from "../ImagineTab";
import { GenerateTab } from "../GenerateTab";
import { TokenizeTab } from "../TokenizeTab";
import styles from "./Aura3DMainPanel.module.css";

const TABS = [
  { id: "imagine" as const, label: "Imagine" },
  { id: "generate" as const, label: "Generate" },
  { id: "tokenize" as const, label: "Tokenize" },
];

export function Aura3DMainPanel({ children: _children }: { children?: ReactNode }) {
  const activeTab = useAura3DStore((s) => s.activeTab);
  const setActiveTab = useAura3DStore((s) => s.setActiveTab);

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
        <div className={styles.tabContent}>
          {activeTab === "imagine" && <ImagineTab />}
          {activeTab === "generate" && <GenerateTab />}
          {activeTab === "tokenize" && <TokenizeTab />}
        </div>
      </div>
    </Lane>
  );
}
