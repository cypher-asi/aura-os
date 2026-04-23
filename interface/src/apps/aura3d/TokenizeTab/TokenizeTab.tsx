import { Coins } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./TokenizeTab.module.css";

export function TokenizeTab() {
  return (
    <div className={styles.root}>
      <EmptyState icon={<Coins size={32} />}>
        Generate an image and 3D model first, then tokenize your asset.
      </EmptyState>
    </div>
  );
}
