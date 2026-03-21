import { useState } from "react";
import { Pencil, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { useFollowStore } from "../stores/follow-store";
import styles from "./FollowEditButton.module.css";

interface FollowEditButtonProps {
  isOwner: boolean;
  targetProfileId?: string;
  onEdit?: () => void;
}

export function FollowEditButton({ isOwner, targetProfileId, onEdit }: FollowEditButtonProps) {
  const isFollowing = useFollowStore((s) => s.isFollowing);
  const toggleFollow = useFollowStore((s) => s.toggleFollow);
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

  if (!targetProfileId) return null;

  const following = isFollowing(targetProfileId);

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
      onClick={() => toggleFollow(targetProfileId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}
