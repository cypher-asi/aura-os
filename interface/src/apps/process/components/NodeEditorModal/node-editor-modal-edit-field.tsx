import type { ReactNode } from "react";
import previewStyles from "../../../../components/Preview/Preview.module.css";

export function NodeEditorEditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={previewStyles.taskField}>
      <span className={previewStyles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}
