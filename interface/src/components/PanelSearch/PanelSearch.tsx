import type { ReactNode } from "react";
import { Input } from "@cypher-asi/zui";
import { Search } from "lucide-react";
import styles from "./PanelSearch.module.css";

interface PanelSearchProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  action?: ReactNode;
}

export function PanelSearch({ placeholder = "", value, onChange, action }: PanelSearchProps) {
  return (
    <div className={styles.root}>
      <Search size={14} className={styles.icon} />
      <Input
        size="sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.searchInput}
        style={action ? { paddingRight: "calc(var(--control-height-sm, 28px) + 2px)" } : undefined}
      />
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
