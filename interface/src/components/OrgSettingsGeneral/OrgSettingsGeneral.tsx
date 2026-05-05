import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Text } from "@cypher-asi/zui";
import { ImagePlus, X } from "lucide-react";
import { formatBuildTime, getBuildInfo } from "../../lib/build-info";
import { UpdateControl, formatLastChecked } from "../UpdateControl";
import { useUpdateStatus } from "../UpdateControl/useUpdateStatus";
import { ImageCropModal } from "../ImageCropModal";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  teamName: string;
  teamAvatarUrl: string;
  onTeamNameChange: (value: string) => void;
  onTeamAvatarChange: (value: string | null) => Promise<void>;
  teamSaving: boolean;
  teamMessage: string;
}

const UPDATE_PANEL_STATUSES = new Set([
  "available",
  "downloading",
  "installing",
  "failed",
]);

export function OrgSettingsGeneral({
  teamName,
  teamAvatarUrl,
  onTeamNameChange,
  onTeamAvatarChange,
  teamSaving,
  teamMessage,
}: Props) {
  const build = getBuildInfo();
  const channelLabel = build.channel.charAt(0).toUpperCase() + build.channel.slice(1);
  const {
    supported: updaterSupported,
    status: updateStatus,
    installPending,
    lastCheckedAt,
  } = useUpdateStatus();
  const lastCheckedLabel = formatLastChecked(lastCheckedAt);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImageSrc, setRawImageSrc] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const showUpdatePanel =
    updaterSupported && (UPDATE_PANEL_STATUSES.has(updateStatus) || installPending);

  useEffect(() => {
    return () => {
      if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    };
  }, [rawImageSrc]);

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
    void onTeamAvatarChange(dataUrl);
    setCropOpen(false);
  }, [onTeamAvatarChange]);

  const handleCropClose = useCallback(() => {
    setCropOpen(false);
  }, []);

  const handleAvatarClick = useCallback(() => {
    if (rawImageSrc) {
      setCropOpen(true);
    } else if (teamAvatarUrl) {
      setRawImageSrc(teamAvatarUrl);
      setCropOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }, [rawImageSrc, teamAvatarUrl]);

  const handleAvatarRemove = useCallback(() => {
    void onTeamAvatarChange(null);
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
  }, [onTeamAvatarChange, rawImageSrc]);

  const handleChangeImage = useCallback(() => {
    setCropOpen(false);
    fileInputRef.current?.click();
  }, []);

  return (
    <>
      <h2 className={styles.sectionTitle}>General</h2>

      <div className={styles.settingsGroupLabel}>Team</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Team Avatar</span>
            <span className={styles.rowDescription}>
              The icon shown in the top bar and team switcher
            </span>
          </div>
          <div className={styles.rowControl}>
            <button
              type="button"
              className={styles.avatarUpload}
              onClick={handleAvatarClick}
              aria-label="Upload team avatar"
            >
              {teamAvatarUrl ? (
                <img src={teamAvatarUrl} alt="Team avatar" className={styles.avatarImg} />
              ) : (
                <ImagePlus size={20} className={styles.avatarPlaceholder} />
              )}
              {teamAvatarUrl && (
                <span
                  className={styles.avatarRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAvatarRemove();
                  }}
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
              onChange={handleFileSelect}
            />
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Team Name</span>
            <span className={styles.rowDescription}>
              The display name for your team
            </span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={teamName}
              onChange={(e) => onTeamNameChange(e.target.value)}
              placeholder="My Team"
              className={styles.inputWidth200}
            />
          </div>
        </div>
      </div>
      {(teamSaving || teamMessage) && (
        <Text variant="muted" size="sm" className={styles.topMarginSm}>
          {teamSaving ? "Saving..." : teamMessage}
        </Text>
      )}

      <div className={styles.settingsGroupLabel}>About</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Version</span>
            <span className={styles.rowDescription}>Current build of Aura</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-version">
              {build.version}
            </Text>
            <Text as="span" variant="muted" size="sm" data-testid="settings-channel">
              ({channelLabel})
            </Text>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Commit</span>
            <span className={styles.rowDescription}>Source revision this build was cut from</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-commit">
              {build.commit}
            </Text>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Built</span>
            <span className={styles.rowDescription}>When this build was produced</span>
          </div>
          <div className={styles.rowControl}>
            <Text as="span" size="sm" data-testid="settings-build-time">
              {formatBuildTime(build.buildTime)}
            </Text>
          </div>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Updates</span>
            <span className={styles.rowDescription}>Check and install new versions.</span>
            {lastCheckedLabel ? (
              <>
                <span
                  className={styles.rowDescription}
                  data-testid="settings-update-last-checked-label"
                >
                  Last checked:
                </span>
                <span
                  className={styles.rowDescription}
                  data-testid="settings-update-last-checked"
                >
                  {lastCheckedLabel}
                </span>
              </>
            ) : null}
          </div>
          <div className={`${styles.rowControl} ${styles.rowControlWide}`}>
            <UpdateControl layout="inline" showLastChecked={false} />
          </div>
        </div>
        {showUpdatePanel ? (
          <div
            className={`${styles.settingsRow} ${styles.settingsRowFull}`}
            data-testid="settings-update-panel-row"
          >
            <UpdateControl layout="panel" />
          </div>
        ) : null}
      </div>
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
