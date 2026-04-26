import { User, MapPin, Globe, Calendar } from "lucide-react";
import type { ReactNode } from "react";
import { EntityCard } from "../../../../components/EntityCard";
import { FollowEditButton } from "../../../../components/FollowEditButton";
import { ProfileEditorModal } from "../../ProfileEditorModal";
import {
  formatJoinedDate,
  formatTokenCount,
  type ProfileSummaryModel,
} from "../profileShared";
import styles from "./ProfileSummaryCard.module.css";

interface ProfileSummaryCardProps {
  summary: ProfileSummaryModel;
  variant?: "sidekick" | "mobile";
  showInlineFollowAction?: boolean;
}

export function ProfileSummaryCard({
  summary,
  variant = "sidekick",
  showInlineFollowAction = true,
}: ProfileSummaryCardProps) {
  const isMobile = variant === "mobile";
  if (isMobile) {
    return <MobileProfileSummaryCard summary={summary} showInlineFollowAction={showInlineFollowAction} />;
  }

  const wrapperClassName = [
    styles.wrapper,
    isMobile ? styles.mobileWrapper : "",
  ].filter(Boolean).join(" ");
  const bioClassName = [
    styles.bioSection,
    isMobile ? styles.mobileBioSection : "",
  ].filter(Boolean).join(" ");
  const bioTextClassName = [
    styles.bioText,
    isMobile ? styles.mobileBioText : "",
  ].filter(Boolean).join(" ");
  const metaGridClassName = [
    styles.metaGrid,
    isMobile ? styles.mobileMetaGrid : "",
  ].filter(Boolean).join(" ");
  const metaRowClassName = [
    styles.metaRow,
    isMobile ? styles.mobileMetaRow : "",
  ].filter(Boolean).join(" ");
  const metaValueClassName = [
    styles.metaValue,
    isMobile ? styles.mobileMetaValue : "",
  ].filter(Boolean).join(" ");
  const metaLinkClassName = [
    styles.metaLink,
    isMobile ? styles.mobileMetaLink : "",
  ].filter(Boolean).join(" ");
  const avatarPlaceholderClassName = [
    styles.avatarPlaceholder,
    isMobile ? styles.mobileAvatarPlaceholder : "",
  ].filter(Boolean).join(" ");
  const placeholderButtonClassName = [
    styles.placeholder,
    styles.placeholderButton,
  ].join(" ");

  return (
    <div className={wrapperClassName}>
      <EntityCard
        headerLabel="PROFILE"
        headerStatus="ACTIVE"
        image={summary.profile.avatarUrl && (summary.profile.avatarUrl.startsWith("http") || summary.profile.avatarUrl.startsWith("data:")) ? summary.profile.avatarUrl : undefined}
        fallbackIcon={
          summary.isOwnProfile ? (
            <button
              type="button"
              className={avatarPlaceholderClassName}
              onClick={summary.openEditor}
            >
              <User size={32} />
              <span>Add profile image</span>
            </button>
          ) : (
            <User size={48} />
          )
        }
        name={summary.profile.name || (summary.isOwnProfile ? "Set your name" : "Unknown")}
        subtitle={summary.profile.handle}
        nameAction={
          showInlineFollowAction && !summary.isOwnProfile ? (
            <FollowEditButton
              isOwner={false}
              targetProfileId={summary.followTargetId}
            />
          ) : undefined
        }
        stats={[
          { value: summary.projectCount, label: "Projects" },
          { value: summary.totalCommits, label: "Commits" },
          { value: formatTokenCount(summary.totalTokenUsage), label: "Tokens" },
        ]}
        footer="AURA"
      >
        <div className={bioClassName}>
          {summary.profile.bio ? (
            <p className={bioTextClassName}>{summary.profile.bio}</p>
          ) : summary.isOwnProfile ? (
            <button
              type="button"
              className={`${bioTextClassName} ${placeholderButtonClassName}`}
              onClick={summary.openEditor}
            >
              Add a bio...
            </button>
          ) : null}
        </div>

        <div className={metaGridClassName}>
          <div className={metaRowClassName}>
            <MapPin size={13} className={styles.metaIcon} />
            {summary.profile.location ? (
              <span className={metaValueClassName}>{summary.profile.location}</span>
            ) : summary.isOwnProfile ? (
              <button
                type="button"
                className={`${metaValueClassName} ${placeholderButtonClassName}`}
                onClick={summary.openEditor}
              >
                Add location
              </button>
            ) : null}
          </div>
          <div className={metaRowClassName}>
            <Globe size={13} className={styles.metaIcon} />
            {summary.profile.website ? (
              <a
                href={summary.profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className={metaLinkClassName}
              >
                {summary.profile.website.replace(/^https?:\/\//, "")}
              </a>
            ) : summary.isOwnProfile ? (
              <button
                type="button"
                className={`${metaValueClassName} ${placeholderButtonClassName}`}
                onClick={summary.openEditor}
              >
                Add website
              </button>
            ) : null}
          </div>
          <div className={metaRowClassName}>
            <Calendar size={13} className={styles.metaIcon} />
            <span className={metaValueClassName}>Joined {formatJoinedDate(summary.profile.joinedDate)}</span>
          </div>
        </div>
      </EntityCard>

      <ProfileEditorModal
        isOpen={summary.editorOpen}
        profile={summary.profile}
        onClose={summary.closeEditor}
        onSave={summary.updateProfile}
      />
    </div>
  );
}

function MobileProfileSummaryCard({
  summary,
  showInlineFollowAction,
}: {
  summary: ProfileSummaryModel;
  showInlineFollowAction: boolean;
}) {
  const avatar = summary.profile.avatarUrl;
  const hasAvatar = avatar && (avatar.startsWith("http") || avatar.startsWith("data:"));
  const name = summary.profile.name || (summary.isOwnProfile ? "Set your name" : "Unknown");
  const joined = formatJoinedDate(summary.profile.joinedDate);

  return (
    <div className={`${styles.wrapper} ${styles.mobileWrapper}`}>
      <section className={styles.mobileProfile} aria-label={`${name} profile`}>
        <button
          type="button"
          className={styles.mobileAvatarButton}
          onClick={summary.isOwnProfile ? summary.openEditor : undefined}
          aria-label={summary.isOwnProfile ? "Edit profile image" : `${name} profile image`}
        >
          {hasAvatar ? (
            <img src={avatar} alt="" className={styles.mobileAvatarImage} />
          ) : (
            <User size={28} />
          )}
        </button>

        <div className={styles.mobileIdentity}>
          <h2 className={styles.mobileName}>{name}</h2>
          <span className={styles.mobileHandle}>{summary.profile.handle}</span>
        </div>

        {summary.profile.bio ? (
          <p className={styles.mobileBioText}>{summary.profile.bio}</p>
        ) : summary.isOwnProfile ? (
          <button
            type="button"
            className={`${styles.mobileBioText} ${styles.mobilePlaceholderButton}`}
            onClick={summary.openEditor}
          >
            Add a bio
          </button>
        ) : null}

        <div className={styles.mobileStats} aria-label="Profile stats">
          <div className={styles.mobileStat}>
            <span className={styles.mobileStatValue}>{summary.projectCount}</span>
            <span className={styles.mobileStatLabel}>Projects</span>
          </div>
          <div className={styles.mobileStat}>
            <span className={styles.mobileStatValue}>{summary.totalCommits}</span>
            <span className={styles.mobileStatLabel}>Commits</span>
          </div>
          <div className={styles.mobileStat}>
            <span className={styles.mobileStatValue}>{formatTokenCount(summary.totalTokenUsage)}</span>
            <span className={styles.mobileStatLabel}>Tokens</span>
          </div>
        </div>

        <div className={styles.mobileMetaList}>
          <MobileMetaRow icon={<MapPin size={16} />} label="Location">
            {summary.profile.location ? (
              <span>{summary.profile.location}</span>
            ) : summary.isOwnProfile ? (
              <button type="button" onClick={summary.openEditor}>Add location</button>
            ) : null}
          </MobileMetaRow>
          <MobileMetaRow icon={<Globe size={16} />} label="Website">
            {summary.profile.website ? (
              <a href={summary.profile.website} target="_blank" rel="noopener noreferrer">
                {summary.profile.website.replace(/^https?:\/\//, "")}
              </a>
            ) : summary.isOwnProfile ? (
              <button type="button" onClick={summary.openEditor}>Add website</button>
            ) : null}
          </MobileMetaRow>
          <MobileMetaRow icon={<Calendar size={16} />} label="Joined">
            <span>{joined}</span>
          </MobileMetaRow>
        </div>

        {summary.isOwnProfile ? (
          <button type="button" className={styles.mobileEditButton} onClick={summary.openEditor}>
            Edit profile
          </button>
        ) : showInlineFollowAction ? (
          <FollowEditButton isOwner={false} targetProfileId={summary.followTargetId} />
        ) : null}
      </section>

      <ProfileEditorModal
        isOpen={summary.editorOpen}
        profile={summary.profile}
        onClose={summary.closeEditor}
        onSave={summary.updateProfile}
      />
    </div>
  );
}

function MobileMetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.mobileMetaRow}>
      <span className={styles.mobileMetaIcon} aria-hidden="true">{icon}</span>
      <span className={styles.mobileMetaLabel}>{label}</span>
      <span className={styles.mobileMetaValue}>{children}</span>
    </div>
  );
}
