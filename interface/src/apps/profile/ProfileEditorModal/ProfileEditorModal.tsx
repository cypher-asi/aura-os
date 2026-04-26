import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Input, Textarea, Button } from "@cypher-asi/zui";
import { ImagePlus, X } from "lucide-react";
import type { UserProfileData } from "../../../stores/profile-store";
import { useModalInitialFocus } from "../../../hooks/use-modal-initial-focus";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { ImageCropModal } from "../../../components/ImageCropModal";
import editorStyles from "../../agents/components/AgentEditorModal/AgentEditorModal.module.css";
import mobileStyles from "./ProfileEditorModal.module.css";

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
  const [rawImageSrc, setRawImageSrc] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const { inputRef: nameRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isMobileLayout } = useAuraCapabilities();

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
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
    setNameError("");
    onClose();
  }, [rawImageSrc, onClose]);

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

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    const objectUrl = URL.createObjectURL(file);
    setRawImageSrc(objectUrl);
    setCropOpen(true);
    e.target.value = "";
  }, [rawImageSrc]);

  const handleCropConfirm = useCallback((dataUrl: string) => {
    setAvatarUrl(dataUrl);
    setCropOpen(false);
  }, []);

  const handleCropClose = useCallback(() => {
    setCropOpen(false);
  }, []);

  const handleAvatarClick = useCallback(() => {
    if (rawImageSrc) {
      setCropOpen(true);
    } else if (avatarUrl) {
      setRawImageSrc(avatarUrl);
      setCropOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }, [rawImageSrc, avatarUrl]);

  const handleAvatarRemove = useCallback(() => {
    setAvatarUrl("");
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
  }, [rawImageSrc]);

  const handleChangeImage = useCallback(() => {
    setCropOpen(false);
    fileInputRef.current?.click();
  }, []);

  const form = (
    <div className={isMobileLayout ? mobileStyles.form : editorStyles.form}>
      <div className={isMobileLayout ? mobileStyles.avatarRow : editorStyles.avatarRow}>
        <button
          type="button"
          className={isMobileLayout ? mobileStyles.avatarUpload : editorStyles.avatarUpload}
          onClick={handleAvatarClick}
          aria-label="Change profile image"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Profile avatar"
              className={isMobileLayout ? mobileStyles.avatarImg : editorStyles.avatarImg}
            />
          ) : (
            <ImagePlus size={24} className={isMobileLayout ? mobileStyles.avatarPlaceholder : editorStyles.avatarPlaceholder} />
          )}
          {avatarUrl && (
            <span
              className={isMobileLayout ? mobileStyles.avatarRemove : editorStyles.avatarRemove}
              onClick={(e) => { e.stopPropagation(); handleAvatarRemove(); }}
            >
              <X size={12} />
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={isMobileLayout ? mobileStyles.hiddenInput : editorStyles.hiddenInput}
          onChange={handleFileSelect}
        />
      </div>

      <div className={isMobileLayout ? mobileStyles.fieldGroup : editorStyles.fieldGroup}>
        <label className={isMobileLayout ? mobileStyles.label : editorStyles.label}>Name *</label>
        <Input
          ref={nameRef}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(""); }}
          placeholder="Display name"
          validationMessage={nameError}
        />
      </div>

      <div className={isMobileLayout ? mobileStyles.fieldGroup : editorStyles.fieldGroup}>
        <label className={isMobileLayout ? mobileStyles.label : editorStyles.label}>Handle</label>
        <Input
          value={profile.handle}
          disabled
          placeholder="@handle"
        />
      </div>

      <div className={isMobileLayout ? mobileStyles.fieldGroup : editorStyles.fieldGroup}>
        <label className={isMobileLayout ? mobileStyles.label : editorStyles.label}>Bio</label>
        <Textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell us about yourself..."
          rows={isMobileLayout ? 4 : 3}
        />
      </div>

      <div className={isMobileLayout ? mobileStyles.fieldGroup : editorStyles.fieldGroup}>
        <label className={isMobileLayout ? mobileStyles.label : editorStyles.label}>Website</label>
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://example.com"
        />
      </div>

      <div className={isMobileLayout ? mobileStyles.fieldGroup : editorStyles.fieldGroup}>
        <label className={isMobileLayout ? mobileStyles.label : editorStyles.label}>Location</label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City, Country"
        />
      </div>
    </div>
  );

  const mobileSheet = isOpen ? (
    <div className={mobileStyles.overlay} role="dialog" aria-modal="true" aria-label="Edit Profile">
      <button type="button" className={mobileStyles.backdrop} aria-label="Close edit profile" onClick={handleClose} />
      <section className={mobileStyles.sheet}>
        <div className={mobileStyles.grabber} aria-hidden="true" />
        <header className={mobileStyles.header}>
          <button type="button" className={mobileStyles.headerButton} onClick={handleClose}>
            Cancel
          </button>
          <h2 className={mobileStyles.title}>Edit Profile</h2>
          <button type="button" className={mobileStyles.headerButtonPrimary} onClick={handleSave}>
            Save
          </button>
        </header>
        <div className={mobileStyles.content}>{form}</div>
      </section>
    </div>
  ) : null;

  return (
    <>
      {isMobileLayout ? mobileSheet : (
        <Modal
          isOpen={isOpen}
          onClose={handleClose}
          title="Edit Profile"
          size="md"
          initialFocusRef={initialFocusRef}
          footer={
            <div className={editorStyles.footer}>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave}>
                Save Changes
              </Button>
            </div>
          }
        >
          {form}
        </Modal>
      )}

      <ImageCropModal
        isOpen={cropOpen}
        imageSrc={rawImageSrc}
        cropShape="round"
        outputSize={256}
        onConfirm={handleCropConfirm}
        onClose={handleCropClose}
        onChangeImage={handleChangeImage}
      />
    </>
  );
}
