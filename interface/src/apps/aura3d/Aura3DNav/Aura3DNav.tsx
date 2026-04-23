import { Box } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./Aura3DNav.module.css";

export function Aura3DNav() {
  const assets = useAura3DStore((s) => s.assets);
  const selectedAssetId = useAura3DStore((s) => s.selectedAssetId);
  const selectAsset = useAura3DStore((s) => s.selectAsset);

  if (assets.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState icon={<Box size={24} />}>
          Generate your first image to get started.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>Assets</div>
      <div className={styles.list}>
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={`${styles.item} ${asset.id === selectedAssetId ? styles.itemActive : ""}`}
            onClick={() => selectAsset(asset.id)}
          >
            {asset.image && (
              <img
                src={asset.image.imageUrl}
                alt={asset.name}
                className={styles.thumb}
              />
            )}
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{asset.name}</span>
              <span className={styles.itemMeta}>
                {asset.model ? "3D" : "Image"}
                {asset.tokenized ? " · NFT" : ""}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
