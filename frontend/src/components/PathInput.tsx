import { useState } from "react";
import { Input, Button } from "@cypher-asi/zui";
import { FolderOpen } from "lucide-react";
import { api } from "../api/client";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode: "folder" | "file";
}

export function PathInput({ value, onChange, placeholder, mode }: PathInputProps) {
  const [picking, setPicking] = useState(false);

  const handleBrowse = async () => {
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
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          mono
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleBrowse}
        disabled={picking}
        title={mode === "folder" ? "Browse for folder" : "Browse for file"}
      >
        <FolderOpen size={16} />
      </Button>
    </div>
  );
}
