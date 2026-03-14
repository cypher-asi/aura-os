import { Button } from "@cypher-asi/zui";
import { useAuth } from "../context/AuthContext";
import { OrgSelector } from "./OrgSelector";
import styles from "./TaskbarLeft.module.css";

interface Props {
  onOpenSettings: () => void;
  onOpenOrgSettings: () => void;
}

export function TaskbarLeft({ onOpenSettings, onOpenOrgSettings }: Props) {
  const { user } = useAuth();

  return (
    <div className={styles.container}>
      <div className={styles.btnWrap}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.taskbarBtn}
          onClick={onOpenSettings}
        >
          {user?.display_name || "User"}
        </Button>
      </div>
      <div className={styles.divider} />
      <div className={styles.orgWrap}>
        <OrgSelector onOpenSettings={onOpenOrgSettings} />
      </div>
    </div>
  );
}
