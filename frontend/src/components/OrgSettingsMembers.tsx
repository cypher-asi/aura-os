import { Button } from "@cypher-asi/zui";
import { UserMinus } from "lucide-react";
import { EmptyState } from "./EmptyState";
import type { OrgMember, OrgRole } from "../types";
import styles from "./OrgSettingsPanel.module.css";

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
              <select
                className={styles.roleSelect}
                value={m.role}
                onChange={(e) => onRoleChange(m.user_id, e.target.value as OrgRole)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
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
