import { Button } from "@cypher-asi/zui";
import { Copy, Trash2 } from "lucide-react";
import { EmptyState } from "../EmptyState";
import type { OrgInvite } from "../../shared/types";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  invites: OrgInvite[];
  isAdminOrOwner: boolean;
  onCreateInvite: () => void;
  onRevokeInvite: (inviteId: string) => void;
}

// Shareable invite links must always point at the production marketing host
// regardless of where the user happens to be running AURA (localhost dev,
// native bundle, or a self-hosted instance), since the recipient generally
// won't have access to those origins.
const INVITE_BASE_URL = "https://aura.ai";

function buildInviteLink(token: string): string {
  return `${INVITE_BASE_URL}/invite/${token}`;
}

export function OrgSettingsInvites({ invites, isAdminOrOwner, onCreateInvite, onRevokeInvite }: Props) {
  const pendingInvites = invites.filter((i) => i.status === "pending");

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(buildInviteLink(token));
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
              {buildInviteLink(inv.token)}
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
