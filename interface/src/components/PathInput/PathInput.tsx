import { useState } from "react";
import { Input } from "@cypher-asi/zui";
import { FolderOpen } from "lucide-react";
import { api } from "../../api/client";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./PathInput.module.css";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode: "folder" | "file";
}

export function PathInput({ value, onChange, placeholder, mode }: PathInputProps) {
  const [picking, setPicking] = useState(false);
  const { features } = useAuraCapabilities();

  const handleBrowse = async () => {
    if (!features.linkedWorkspace) return;
    setPicking(true);
    try {
      const path = mode === "folder" ? await api.pickFolder() : await api.pickFile();
      if (path) onChange(path);
    } catch {
      // Native dialog unavailable or cancelled -- user can still type manually
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        mono
        className={styles.inputPadded}
      />
      <button
        type="button"
        onClick={handleBrowse}
        disabled={picking || !features.linkedWorkspace}
        title={mode === "folder" ? "Browse for folder" : "Browse for file"}
        className={styles.browseButton}
        style={{
          cursor: picking || !features.linkedWorkspace ? "default" : "pointer",
          opacity: picking || !features.linkedWorkspace ? 0.4 : 0.6,
        }}
        onMouseEnter={(e) => { if (!picking && features.linkedWorkspace) e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { if (!picking && features.linkedWorkspace) e.currentTarget.style.opacity = "0.6"; }}
      >
        <FolderOpen size={16} />
      </button>
    </div>
  );
}
