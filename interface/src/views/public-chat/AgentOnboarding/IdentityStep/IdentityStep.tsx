import { useCallback, useRef, useState } from "react";
import { Sparkles, Upload } from "lucide-react";
import { ImageCropModal } from "../../../../components/ImageCropModal/ImageCropModal";
import type { OnboardingAvatar, PersonalityPreset } from "../onboarding-data";
import { pickRandomPersonality } from "./pick-personality";
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

  const handleGenerate = useCallback(() => {
    const next = pickRandomPersonality(personalities, selectedPersonality);
    if (next) onSelectPersonality(next.description);
  }, [personalities, selectedPersonality, onSelectPersonality]);

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
        <div className={styles.sectionHeaderRow}>
          <div>
            <h3 id="identity-personality-heading" className={styles.sectionTitle}>
              Personality
            </h3>
            <p className={styles.sectionHint}>How your agent communicates and makes decisions.</p>
          </div>
          <button type="button" className={styles.generateButton} onClick={handleGenerate}>
            <Sparkles size={14} aria-hidden="true" />
            Generate
          </button>
        </div>
        <div className={styles.personalityGrid}>
          {personalities.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={styles.personalityCard}
              data-selected={preset.description === selectedPersonality}
              aria-pressed={preset.description === selectedPersonality}
              onClick={() => onSelectPersonality(preset.description)}
            >
              <span className={styles.personalityName}>{preset.name}</span>
              <span className={styles.personalityDescription}>{preset.description}</span>
            </button>
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
