import { Box } from "lucide-react";
import { Button, Spinner } from "@cypher-asi/zui";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./ModelGeneration.module.css";

export function ModelGeneration() {
  const generateSourceImage = useAura3DStore((s) => s.generateSourceImage);
  const isGenerating3D = useAura3DStore((s) => s.isGenerating3D);
  const generate3DProgress = useAura3DStore((s) => s.generate3DProgress);
  const generate3DProgressMessage = useAura3DStore((s) => s.generate3DProgressMessage);
  const current3DModel = useAura3DStore((s) => s.current3DModel);

  if (!generateSourceImage && !current3DModel) {
    return (
      <div className={styles.root}>
        <EmptyState icon={<Box size={32} />}>
          Generate an image above, then convert it to a 3D model.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.sectionTitle}>3D Model</span>
      </div>
      <div className={styles.viewerArea}>
        {current3DModel ? (
          <div className={styles.placeholder}>
            <Box size={48} className={styles.placeholderIcon} />
            <span className={styles.placeholderText}>
              WebGL viewer — Sprint 3
            </span>
            <span className={styles.modelUrl}>{current3DModel.glbUrl}</span>
          </div>
        ) : generateSourceImage ? (
          <div className={styles.sourcePreview}>
            <img
              src={generateSourceImage.imageUrl}
              alt="Source for 3D generation"
              className={styles.sourceImage}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.actionBar}>
        <Button
          variant="primary"
          onClick={() => {
            // 3D generation wired in Sprint 3
          }}
          disabled={!generateSourceImage || isGenerating3D}
        >
          {isGenerating3D ? (
            <>
              <Spinner size="sm" />
              <span>{generate3DProgressMessage || `${generate3DProgress}%`}</span>
            </>
          ) : (
            "Generate 3D"
          )}
        </Button>
      </div>
    </div>
  );
}
