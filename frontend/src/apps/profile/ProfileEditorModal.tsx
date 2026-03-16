import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Input, Textarea, Button } from "@cypher-asi/zui";
import { ImagePlus, X } from "lucide-react";
import type { UserProfileData } from "./ProfileProvider";
import styles from "../../components/AgentEditorModal.module.css";

interface ProfileEditorModalProps {
  isOpen: boolean;
  profile: UserProfileData;
  onClose: () => void;
  onSave: (data: Partial<UserProfileData>) => void;
}

export function ProfileEditorModal({ isOpen, profile, onClose, onSave }: ProfileEditorModalProps) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(profile.name);
    setHandle(profile.handle);
    setBio(profile.bio);
    setWebsite(profile.website);
    setLocation(profile.location);
    setAvatarUrl(profile.avatarUrl ?? "");
    setNameError("");
  }, [isOpen, profile]);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => nameRef.current?.focus());
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setNameError("");
    onClose();
  }, [onClose]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(128 / img.width, 128 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
      setAvatarUrl(canvas.toDataURL("image/webp", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  }, []);

  const handleSave = () => {
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    setNameError("");
    onSave({
      name: name.trim(),
      handle: handle.trim(),
      bio: bio.trim(),
      website: website.trim(),
      location: location.trim(),
      avatarUrl: avatarUrl || undefined,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Profile"
      size="md"
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
        <div className={styles.avatarRow}>
          <button
            type="button"
            className={styles.avatarUpload}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile avatar" className={styles.avatarImg} />
            ) : (
              <ImagePlus size={24} className={styles.avatarPlaceholder} />
            )}
            {avatarUrl && (
              <span
                className={styles.avatarRemove}
                onClick={(e) => { e.stopPropagation(); setAvatarUrl(""); }}
              >
                <X size={12} />
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.hiddenInput}
            onChange={handleImageSelect}
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
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
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
