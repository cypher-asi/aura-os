import { useState, useEffect, useCallback } from "react";
import { Modal, Input, Textarea, Button } from "@cypher-asi/zui";
import type { UserProfileData } from "./ProfileProvider";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import styles from "../../components/AgentEditorModal.module.css";

interface ProfileEditorModalProps {
  isOpen: boolean;
  profile: UserProfileData;
  onClose: () => void;
  onSave: (data: Partial<UserProfileData>) => void;
}

export function ProfileEditorModal({ isOpen, profile, onClose, onSave }: ProfileEditorModalProps) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [nameError, setNameError] = useState("");
  const { inputRef: nameRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setName(profile.name);
      setBio(profile.bio);
      setWebsite(profile.website);
      setLocation(profile.location);
      setAvatarUrl(profile.avatarUrl ?? "");
      setNameError("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, profile]);

  const handleClose = useCallback(() => {
    setNameError("");
    onClose();
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    setNameError("");
    onSave({
      name: name.trim(),
      bio: bio.trim(),
      website: website.trim(),
      location: location.trim(),
      avatarUrl: avatarUrl.trim() || undefined,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Profile"
      size="md"
      initialFocusRef={initialFocusRef}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Avatar URL</label>
          <Input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Name *</label>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(""); }}
            placeholder="Display name"
            validationMessage={nameError}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Handle</label>
          <Input
            value={profile.handle}
            disabled
            placeholder="@handle"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Bio</label>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself..."
            rows={3}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Website</label>
          <Input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Location</label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, Country"
          />
        </div>
      </div>
    </Modal>
  );
}
