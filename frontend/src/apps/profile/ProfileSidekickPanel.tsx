import { useState } from "react";
import { User, Send, MapPin, Globe, Calendar, Pencil, LogOut } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { EntityCard } from "../../components/EntityCard";
import { FollowEditButton } from "../../components/FollowEditButton";
import { Avatar } from "../../components/Avatar";
import { useProfile } from "./ProfileProvider";
import { useAuth } from "../../context/AuthContext";
import { ProfileEditorModal } from "./ProfileEditorModal";
import { timeAgo } from "../feed/FeedMainPanel";
import styles from "./ProfileSidekickPanel.module.css";

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ProfileCard() {
  const { profile, updateProfile, events, projects, totalTokenUsage } = useProfile();
  const { user, logout } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);

  const isOwnProfile = !!user && (
    user.display_name === profile.name ||
    profile.handle === `@${user.primary_zid}`
  );
  const totalCommits = events.reduce((sum, e) => sum + e.commits.length, 0);

  return (
    <div className={styles.profileCardWrapper}>
      <EntityCard
        headerLabel="PROFILE"
        headerStatus="ACTIVE"
        image={profile.avatarUrl && profile.avatarUrl.startsWith("http") ? profile.avatarUrl : undefined}
        fallbackIcon={
          isOwnProfile ? (
            <button
              type="button"
              className={styles.avatarPlaceholder}
              onClick={() => setEditorOpen(true)}
            >
              <User size={32} />
              <span>Add profile image</span>
            </button>
          ) : (
            <User size={48} />
          )
        }
        name={profile.name || (isOwnProfile ? "Set your name" : "Unknown")}
        subtitle={profile.handle}
        nameAction={
          !isOwnProfile ? (
            <FollowEditButton
              isOwner={false}
              targetProfileId={profile.id}
            />
          ) : undefined
        }
        stats={[
          { value: projects.length, label: "Projects" },
          { value: totalCommits, label: "Commits" },
          { value: formatTokenCount(totalTokenUsage), label: "Tokens" },
        ]}
        footer="CYPHER-ASI // AURA"
      >
        <div className={styles.bioSection}>
          {profile.bio ? (
            <p className={styles.bioText}>{profile.bio}</p>
          ) : isOwnProfile ? (
            <p
              className={`${styles.bioText} ${styles.placeholder}`}
              onClick={() => setEditorOpen(true)}
            >
              Add a bio...
            </p>
          ) : null}
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaRow}>
            <MapPin size={13} className={styles.metaIcon} />
            {profile.location ? (
              <span className={styles.metaValue}>{profile.location}</span>
            ) : isOwnProfile ? (
              <span
                className={`${styles.metaValue} ${styles.placeholder}`}
                onClick={() => setEditorOpen(true)}
              >
                Add location
              </span>
            ) : null}
          </div>
          <div className={styles.metaRow}>
            <Globe size={13} className={styles.metaIcon} />
            {profile.website ? (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.metaLink}
              >
                {profile.website.replace(/^https?:\/\//, "")}
              </a>
            ) : isOwnProfile ? (
              <span
                className={`${styles.metaValue} ${styles.placeholder}`}
                onClick={() => setEditorOpen(true)}
              >
                Add website
              </span>
            ) : null}
          </div>
          <div className={styles.metaRow}>
            <Calendar size={13} className={styles.metaIcon} />
            <span className={styles.metaValue}>Joined {formatJoinedDate(profile.joinedDate)}</span>
          </div>
        </div>
      </EntityCard>

      {isOwnProfile && (
        <div className={styles.floatingActions}>
          <button
            type="button"
            className={styles.floatingEditButton}
            onClick={() => setEditorOpen(true)}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={styles.floatingEditButton}
            onClick={logout}
            aria-label="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      )}

      <ProfileEditorModal
        isOpen={editorOpen}
        profile={profile}
        onClose={() => setEditorOpen(false)}
        onSave={updateProfile}
      />
    </div>
  );
}

function CommentsPanel() {
  const { selectedEventId, getCommentsForEvent, addComment } = useProfile();
  const [draft, setDraft] = useState("");

  if (!selectedEventId) return null;

  const comments = getCommentsForEvent(selectedEventId);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    addComment(selectedEventId, text);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={styles.commentsPanel}>
      <div className={styles.commentList}>
        {comments.length === 0 ? (
          <EmptyState>No comments yet</EmptyState>
        ) : (
          comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <Avatar
                avatarUrl={c.author.avatarUrl}
                name={c.author.name}
                type={c.author.type}
                size={28}
                className={styles.commentAvatar}
              />
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.commentAuthor}>{c.author.name}</span>
                  <span className={styles.commentTime}>{timeAgo(c.timestamp)}</span>
                </div>
                <span className={styles.commentText}>{c.text}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.inputArea}>
        <input
          className={styles.inputField}
          placeholder="Add a comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className={styles.sendButton}
          onClick={handleSubmit}
          disabled={!draft.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

export function ProfileSidekickPanel() {
  const { selectedEventId } = useProfile();

  if (selectedEventId) {
    return <CommentsPanel />;
  }

  return <ProfileCard />;
}
