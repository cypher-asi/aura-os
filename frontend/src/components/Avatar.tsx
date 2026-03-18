import { useState } from "react";
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
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  const fallback = isAgent ? <Bot size={iconSize} /> : <User size={iconSize} />;

  return (
    <div
      className={`${styles.avatar} ${className ?? ""}`}
      data-agent={isAgent}
      style={{ width: size, height: size, ...style }}
      onClick={onClick}
    >
      {showImage ? (
        <img src={avatarUrl} alt={name ?? type} onError={() => setBroken(true)} />
      ) : (
        fallback
      )}
    </div>
  );
}
