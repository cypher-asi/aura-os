import { Bot, User } from "lucide-react";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  avatarUrl?: string;
  name?: string;
  type: "user" | "agent";
  size: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export function Avatar({ avatarUrl, name, type, size, className, style, onClick }: AvatarProps) {
  const iconSize = Math.round(size * 0.5);
  const isAgent = type === "agent";

  return (
    <div
      className={`${styles.avatar} ${className ?? ""}`}
      data-agent={isAgent}
      style={{ width: size, height: size, ...style }}
      onClick={onClick}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name ?? type} />
      ) : isAgent ? (
        <Bot size={iconSize} />
      ) : (
        <User size={iconSize} />
      )}
    </div>
  );
}
