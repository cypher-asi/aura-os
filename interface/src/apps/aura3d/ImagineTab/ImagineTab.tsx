import { ImageIcon } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./ImagineTab.module.css";

export function ImagineTab() {
  return (
    <div className={styles.root}>
      <EmptyState icon={<ImageIcon size={32} />}>
        Describe your 3D asset to generate an image.
      </EmptyState>
    </div>
  );
}
