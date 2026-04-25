import type { SkillOS } from "../../shared/types";
import styles from "./SkillShopModal.module.css";

const OS_OPTIONS: { id: SkillOS | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "windows", label: "Windows" },
  { id: "mac", label: "Mac" },
  { id: "linux", label: "Linux" },
];

interface OsFilterBarProps {
  selected: SkillOS | "all";
  onSelect: (os: SkillOS | "all") => void;
}

export function OsFilterBar({ selected, onSelect }: OsFilterBarProps) {
  return (
    <div className={styles.osFilterBar}>
      {OS_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`${styles.osFilterBtn} ${opt.id === selected ? styles.osFilterActive : ""}`}
          onClick={() => onSelect(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
