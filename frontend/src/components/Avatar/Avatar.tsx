import { useState } from "react";
import { Bot, User } from "lucide-react";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  avatarUrl?: string;
  name?: string;
  type: "user" | "agent";
  size: number;
  /** Pre-resolved dot status (e.g. "running", "idle", "error"). */
  status?: string;
  /** When true, dot renders purple regardless of status. */
  isLocal?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export function Avatar({ avatarUrl, name, type, size, status, isLocal, className, style, onClick }: AvatarProps) {
  const iconSize = Math.round(size * 0.5);
  const isAgent = type === "agent";
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  const fallback = isAgent ? <Bot size={iconSize} /> : <User size={iconSize} />;
  const showDot = !!status || isLocal;

  return (
    <div
      className={`${styles.avatarWrap} ${className ?? ""}`}
      style={{ width: size, height: size, ...style }}
      onClick={onClick}
    >
      <div className={styles.avatar} data-agent={isAgent}>
        {showImage ? (
          <img src={avatarUrl} alt={name ?? type} onError={() => setBroken(true)} />
        ) : (
          fallback
        )}
      </div>
      {showDot && (
        <span
          className={styles.statusDot}
          data-status={status ?? "idle"}
          data-machine={isLocal ? "local" : undefined}
        />
      )}
    </div>
  );
}
