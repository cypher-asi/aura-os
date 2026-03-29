import { useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrgStore } from "../../stores/org-store";
import { Building2, ChevronDown, Plus } from "lucide-react";
import { Button, Input, Modal } from "@cypher-asi/zui";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useUIModalStore } from "../../stores/ui-modal-store";
import styles from "./OrgSelector.module.css";

export function OrgSelector({
  variant = "default",
}: {
  variant?: "default" | "drawer";
} = {}) {
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const { orgs, activeOrg, switchOrg, createOrg } = useOrgStore(
    useShallow((s) => ({ orgs: s.orgs, activeOrg: s.activeOrg, switchOrg: s.switchOrg, createOrg: s.createOrg })),
  );
  const { inputRef: newNameRef, initialFocusRef, autoFocus } = useModalInitialFocus<HTMLInputElement>();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const org = await createOrg(newName.trim());
      switchOrg(org.org_id);
      setNewName("");
      setShowCreate(false);
    } catch (err) {
      console.error("Failed to create org", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={`${styles.container} ${variant === "drawer" ? styles.drawerContainer : ""}`}
      ref={dropdownRef}
    >
      <button
        type="button"
        className={`${styles.trigger} ${variant === "drawer" ? styles.drawerTrigger : ""}`}
        onClick={() => setDropdownOpen((v) => !v)}
      >
        {variant === "drawer" && <Building2 size={14} className={styles.triggerIcon} />}
        <span className={styles.name}>{activeOrg?.name ?? "My Team"}</span>
        <ChevronDown size={12} className={styles.chevron} />
      </button>

      {dropdownOpen && (
        <div className={styles.dropdown}>
          {orgs.map((org) => (
            <button
              key={org.org_id}
              type="button"
              className={`${styles.item} ${org.org_id === activeOrg?.org_id ? styles.active : ""}`}
              onClick={() => {
                switchOrg(org.org_id);
                setDropdownOpen(false);
              }}
            >
              <Building2 size={12} />
              <span>{org.name}</span>
            </button>
          ))}
          <div className={styles.divider} />
          <button
            type="button"
            className={styles.item}
            onClick={() => {
              setDropdownOpen(false);
              setShowCreate(true);
            }}
          >
            <Plus size={12} />
            <span>New Team</span>
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={() => {
              setDropdownOpen(false);
              openOrgSettings();
            }}
          >
            <span>Team Settings</span>
          </button>
        </div>
      )}

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Team"
        size="sm"
        initialFocusRef={initialFocusRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </>
        }
      >
        <Input
          ref={newNameRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          placeholder="Team name"
          autoFocus={autoFocus}
        />
      </Modal>
    </div>
  );
}
