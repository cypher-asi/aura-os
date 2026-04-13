import { Plus } from "lucide-react";
import styles from "./ProjectsPlusButton.module.css";

export interface ProjectsPlusButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  className?: string;
}

export function ProjectsPlusButton({
  onClick,
  title,
  disabled = false,
  className,
}: ProjectsPlusButtonProps) {
  const buttonClassName = [styles.button, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={buttonClassName}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <Plus size={10} strokeWidth={2} />
    </button>
  );
}
