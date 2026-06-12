import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { ImageCropModal } from "../../../../components/ImageCropModal/ImageCropModal";
import { SelectableCard } from "../SelectableCard";
import type { OnboardingAvatar, PersonalityPreset } from "../onboarding-data";
import styles from "./IdentityStep.module.css";

interface IdentityStepProps {
  readonly avatars: readonly OnboardingAvatar[];
  readonly selectedAvatar: string | null;
  readonly onSelectAvatar: (icon: string) => void;
  readonly personalities: readonly PersonalityPreset[];
  readonly selectedPersonality: string;
  readonly onSelectPersonality: (description: string) => void;
}

export function IdentityStep({
  avatars,
  selectedAvatar,
  onSelectAvatar,
  personalities,
  selectedPersonality,
  onSelectPersonality,
}: IdentityStepProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState<string | null>(null);

  const isUploadedAvatar =
    selectedAvatar !== null && !avatars.some((a) => a.icon === selectedAvatar);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setRawImage(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleCropConfirm = useCallback(
    (dataUrl: string) => {
      onSelectAvatar(dataUrl);
      setRawImage(null);
    },
    [onSelectAvatar],
  );

  return (
    <div className={styles.step}>
      <section className={styles.section} aria-labelledby="identity-avatar-heading">
        <h3 id="identity-avatar-heading" className={styles.sectionTitle}>
          Profile picture
        </h3>
        <p className={styles.sectionHint}>Pick a look for your agent, or upload your own.</p>
        <div className={styles.avatarGrid}>
          {avatars.map((avatar) => (
            <button
              key={avatar.id}
              type="button"
              className={styles.avatarTile}
              data-selected={avatar.icon === selectedAvatar}
              aria-label={avatar.label}
              aria-pressed={avatar.icon === selectedAvatar}
              onClick={() => onSelectAvatar(avatar.icon)}
            >
              <span className={styles.avatarImage} style={{ backgroundImage: `url("${avatar.icon}")` }} />
            </button>
          ))}
          <button
            type="button"
            className={styles.uploadTile}
            data-selected={isUploadedAvatar}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploadedAvatar && selectedAvatar ? (
              <span className={styles.avatarImage} style={{ backgroundImage: `url("${selectedAvatar}")` }} />
            ) : (
              <>
                <Upload size={18} aria-hidden="true" />
                <span className={styles.uploadLabel}>Upload</span>
              </>
            )}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </section>

      <section className={styles.section} aria-labelledby="identity-personality-heading">
        <h3 id="identity-personality-heading" className={styles.sectionTitle}>
          Personality
        </h3>
        <p className={styles.sectionHint}>How your agent communicates and makes decisions.</p>
        <div className={styles.personalityGrid}>
          {personalities.map((preset) => (
            <SelectableCard
              key={preset.id}
              title={preset.name}
              description={preset.description}
              Icon={preset.Icon}
              selected={preset.description === selectedPersonality}
              onSelect={() => onSelectPersonality(preset.description)}
            />
          ))}
        </div>
      </section>

      {rawImage ? (
        <ImageCropModal
          isOpen
          imageSrc={rawImage}
          cropShape="round"
          onConfirm={handleCropConfirm}
          onClose={() => setRawImage(null)}
          onChangeImage={() => fileInputRef.current?.click()}
        />
      ) : null}
    </div>
  );
}
