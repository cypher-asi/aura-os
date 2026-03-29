import { useState } from "react";
import { Pencil, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { useFollowStore } from "../../stores/follow-store";
import styles from "./FollowEditButton.module.css";

interface FollowEditButtonProps {
  isOwner: boolean;
  targetProfileId?: string;
  onEdit?: () => void;
  className?: string;
  size?: "compact" | "touch";
}

export function FollowEditButton({
  isOwner,
  targetProfileId,
  onEdit,
  className,
  size = "compact",
}: FollowEditButtonProps) {
  const isFollowing = useFollowStore((s) => s.isFollowing);
  const toggleFollow = useFollowStore((s) => s.toggleFollow);
  const [hover, setHover] = useState(false);
  const buttonClassName = [
    styles.button,
    size === "touch" ? styles.touch : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  if (isOwner) {
    if (!onEdit) return null;
    return (
      <button type="button" className={buttonClassName} onClick={onEdit}>
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
      className={`${buttonClassName} ${following ? styles.following : ""}`}
      onClick={() => toggleFollow(targetProfileId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}
