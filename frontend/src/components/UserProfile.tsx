import { Button } from "@cypher-asi/zui";
import { LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import styles from "./UserProfile.module.css";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserProfile() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className={styles.container}>
      <div className={styles.avatar}>
        {user.profile_image ? (
          <img
            src={user.profile_image}
            alt={user.display_name}
            className={styles.avatarImg}
          />
        ) : (
          getInitials(user.display_name || user.primary_zid || "U")
        )}
      </div>
      <div className={styles.info}>
        <span className={styles.name}>{user.display_name || "User"}</span>
        {user.primary_zid && (
          <span className={styles.zid}>{user.primary_zid}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={<LogOut size={14} />}
        iconOnly
        aria-label="Logout"
        onClick={logout}
      />
    </div>
  );
}
