import { useState } from "react";
import { Bot, User } from "lucide-react";
import styles from "./Avatar.module.css";

const STATUS_MAP: Record<string, string> = {
  running: "running",
  working: "running",
  idle: "idle",
  provisioning: "provisioning",
  hibernating: "hibernating",
  stopping: "stopping",
  stopped: "stopped",
  error: "error",
  blocked: "error",
};

function normalizeStatus(status?: string): string | undefined {
  if (!status) return undefined;
  return STATUS_MAP[status.toLowerCase()];
}

export interface AvatarProps {
  avatarUrl?: string;
  name?: string;
  type: "user" | "agent";
  size: number;
  status?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export function Avatar({ avatarUrl, name, type, size, status, className, style, onClick }: AvatarProps) {
  const iconSize = Math.round(size * 0.5);
  const isAgent = type === "agent";
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  const fallback = isAgent ? <Bot size={iconSize} /> : <User size={iconSize} />;
  const resolvedStatus = normalizeStatus(status);

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
      {resolvedStatus && (
        <span className={styles.statusDot} data-status={resolvedStatus} />
      )}
    </div>
  );
}
