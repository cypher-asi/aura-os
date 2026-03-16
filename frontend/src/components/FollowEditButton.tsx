import { useState } from "react";
import { Pencil, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { useFollow } from "../context/FollowContext";
import type { FollowTargetType } from "../types";
import styles from "./FollowEditButton.module.css";

interface FollowEditButtonProps {
  isOwner: boolean;
  targetType: FollowTargetType;
  targetName: string;
  onEdit?: () => void;
}

export function FollowEditButton({ isOwner, targetType, targetName, onEdit }: FollowEditButtonProps) {
  const { isFollowing, toggleFollow } = useFollow();
  const [hover, setHover] = useState(false);

  if (isOwner) {
    if (!onEdit) return null;
    return (
      <button type="button" className={styles.button} onClick={onEdit}>
        <Pencil size={12} />
        Edit
      </button>
    );
  }

  const following = isFollowing(targetType, targetName);

  const icon = following
    ? hover ? <UserMinus size={12} /> : <UserCheck size={12} />
    : <UserPlus size={12} />;

  const label = following
    ? hover ? "Unfollow" : "Following"
    : "Follow";

  return (
    <button
      type="button"
      className={`${styles.button} ${following ? styles.following : ""}`}
      onClick={() => toggleFollow(targetType, targetName)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}
