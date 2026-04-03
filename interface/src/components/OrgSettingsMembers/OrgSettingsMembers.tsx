import { Button } from "@cypher-asi/zui";
import { UserMinus } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { Select } from "../Select";
import type { OrgMember, OrgRole } from "../../types";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

interface Props {
  members: OrgMember[];
  myRole: OrgRole | undefined;
  currentUserId: string | undefined;
  isAdminOrOwner: boolean;
  onRoleChange: (userId: string, role: OrgRole) => void;
  onRemoveMember: (userId: string) => void;
}

export function OrgSettingsMembers({
  members,
  myRole,
  currentUserId,
  isAdminOrOwner,
  onRoleChange,
  onRemoveMember,
}: Props) {
  return (
    <>
      <h2 className={styles.sectionTitle}>Members</h2>

      <div className={styles.settingsGroupLabel}>
        Team Members ({members.length})
      </div>
      <div className={styles.settingsGroup}>
        {members.map((m) => {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.display_name);
          const name = (!m.display_name || isUuid) ? "Unknown User" : m.display_name;
          return (
          <div key={m.user_id} className={styles.memberRow}>
            <span className={styles.memberName}>{name}</span>
            {myRole === "owner" && m.user_id !== currentUserId ? (
              <Select
                className={styles.roleSelect}
                value={m.role}
                onChange={(v) => onRoleChange(m.user_id, v as OrgRole)}
                options={ROLE_OPTIONS}
              />
            ) : (
              <span className={styles.roleBadge}>{m.role}</span>
            )}
            {isAdminOrOwner && m.role !== "owner" && m.user_id !== currentUserId && (
              <Button
                variant="ghost"
                size="sm"
                icon={<UserMinus size={14} />}
                iconOnly
                aria-label="Remove member"
                onClick={() => onRemoveMember(m.user_id)}
              />
            )}
          </div>
          );
        })}
        {members.length === 0 && (
          <EmptyState>No members yet</EmptyState>
        )}
      </div>
    </>
  );
}
