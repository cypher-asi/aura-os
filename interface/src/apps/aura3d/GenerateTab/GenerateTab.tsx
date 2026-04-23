import { Box } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./GenerateTab.module.css";

export function GenerateTab() {
  return (
    <div className={styles.root}>
      <EmptyState icon={<Box size={32} />}>
        Generate an image first, then convert it to a 3D model.
      </EmptyState>
    </div>
  );
}
