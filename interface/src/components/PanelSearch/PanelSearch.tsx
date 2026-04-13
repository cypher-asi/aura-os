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

export function PanelSearch({ placeholder = "Search", value, onChange, action }: PanelSearchProps) {
  return (
    <div className={styles.root}>
      <Search size={14} className={styles.icon} />
      <Input
        size="sm"
        variant="underline"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.searchInput}
        style={action ? { paddingRight: "calc(var(--space-4, 16px) + var(--control-height-sm, 28px))" } : undefined}
      />
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
