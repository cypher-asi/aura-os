import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { Bot, User, Send, MapPin, Globe, Calendar, Pencil, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { EntityCard } from "../../components/EntityCard";
import { useProfile } from "./ProfileProvider";
import { useFollow } from "../../context/FollowContext";
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

function FollowButton({ targetName }: { targetName: string }) {
  const { isFollowing, toggleFollow } = useFollow();
  const [hover, setHover] = useState(false);
  const following = isFollowing("user", targetName);

  const icon = following
    ? hover ? <UserMinus size={12} /> : <UserCheck size={12} />
    : <UserPlus size={12} />;

  const label = following
    ? hover ? "Unfollow" : "Following"
    : "Follow";

  return (
    <button
      type="button"
      className={`${styles.editButton} ${following ? styles.followingButton : ""}`}
      onClick={() => toggleFollow("user", targetName)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}

function ProfileCard() {
  const { profile, updateProfile, events, projects, totalTokenUsage } = useProfile();
  const { user } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);

  const isOwnProfile = user?.display_name === profile.name;
  const totalCommits = events.reduce((sum, e) => sum + e.commits.length, 0);

  return (
    <>
      <EntityCard
        headerLabel="PROFILE"
        headerStatus="ACTIVE"
        image={profile.avatarUrl}
        fallbackIcon={<User size={48} />}
        name={profile.name}
        subtitle={profile.handle}
        stats={[
          { value: projects.length, label: "Projects" },
          { value: totalCommits, label: "Commits" },
          { value: formatTokenCount(totalTokenUsage), label: "Tokens" },
        ]}
        footer="CYPHER-ASI // AURA"
      >
        <div className={styles.bioSection}>
          <p className={styles.bioText}>{profile.bio}</p>
          <div className={styles.profileActions}>
            {isOwnProfile ? (
              <button
                type="button"
                className={styles.editButton}
                onClick={() => setEditorOpen(true)}
              >
                <Pencil size={12} />
                Edit Profile
              </button>
            ) : (
              <FollowButton targetName={profile.name} />
            )}
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaRow}>
            <MapPin size={13} className={styles.metaIcon} />
            <span className={styles.metaValue}>{profile.location}</span>
          </div>
          <div className={styles.metaRow}>
            <Globe size={13} className={styles.metaIcon} />
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.metaLink}
            >
              {profile.website.replace(/^https?:\/\//, "")}
            </a>
          </div>
          <div className={styles.metaRow}>
            <Calendar size={13} className={styles.metaIcon} />
            <span className={styles.metaValue}>Joined {formatJoinedDate(profile.joinedDate)}</span>
          </div>
        </div>
      </EntityCard>

      <ProfileEditorModal
        isOpen={editorOpen}
        profile={profile}
        onClose={() => setEditorOpen(false)}
        onSave={updateProfile}
      />
    </>
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
          <div className={styles.emptyComments}>
            <Text variant="muted" size="sm">No comments yet</Text>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <div className={styles.commentAvatar}>
                {c.author.type === "agent" ? <Bot size={14} /> : <User size={14} />}
              </div>
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
