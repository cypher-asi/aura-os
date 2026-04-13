import { User, MapPin, Globe, Calendar } from "lucide-react";
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
        footer="CYPHER-ASI // AURA"
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

