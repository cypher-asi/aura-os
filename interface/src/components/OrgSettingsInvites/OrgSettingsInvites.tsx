import { Button } from "@cypher-asi/zui";
import { Copy, Trash2 } from "lucide-react";
import { EmptyState } from "../EmptyState";
import type { OrgInvite } from "../../types";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  invites: OrgInvite[];
  isAdminOrOwner: boolean;
  onCreateInvite: () => void;
  onRevokeInvite: (inviteId: string) => void;
}

export function OrgSettingsInvites({ invites, isAdminOrOwner, onCreateInvite, onRevokeInvite }: Props) {
  const pendingInvites = invites.filter((i) => i.status === "pending");

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>Invites</h2>

      <div className={styles.settingsGroupLabel}>Invite Links</div>
      <div className={styles.settingsGroup}>
        {isAdminOrOwner && (
          <div className={styles.inviteActions}>
            <Button variant="primary" size="sm" onClick={onCreateInvite}>
              Generate Invite Link
            </Button>
          </div>
        )}
        {pendingInvites.map((inv) => (
          <div key={inv.invite_id} className={styles.inviteRow}>
            <code className={styles.inviteToken}>
              {`${window.location.origin}/invite/${inv.token}`}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy size={14} />}
              iconOnly
              aria-label="Copy link"
              onClick={() => copyInviteLink(inv.token)}
            />
            {isAdminOrOwner && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                iconOnly
                aria-label="Revoke"
                onClick={() => onRevokeInvite(inv.invite_id)}
              />
            )}
          </div>
        ))}
        {pendingInvites.length === 0 && (
          <EmptyState>No pending invites</EmptyState>
        )}
      </div>
    </>
  );
}
