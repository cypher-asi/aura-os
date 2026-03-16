import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { Bot, User, MessageSquare, Send, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { EntityCard } from "../../components/EntityCard";
import { useFeed } from "./FeedProvider";
import { useFollow } from "../../context/FollowContext";
import { timeAgo } from "./FeedMainPanel";
import type { FollowTargetType } from "../../types";
import styles from "./FeedSidekickPanel.module.css";

function ProfileFollowButton({ targetName, targetType }: { targetName: string; targetType: FollowTargetType }) {
  const { isFollowing, toggleFollow } = useFollow();
  const [hover, setHover] = useState(false);
  const following = isFollowing(targetType, targetName);

  const icon = following
    ? hover ? <UserMinus size={12} /> : <UserCheck size={12} />
    : <UserPlus size={12} />;

  const label = following
    ? hover ? "Unfollow" : "Following"
    : "Follow";

  return (
    <button
      type="button"
      className={`${styles.followButton} ${following ? styles.followingState : ""}`}
      onClick={() => toggleFollow(targetType, targetName)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}

function ProfilePanel() {
  const { selectedProfile, events } = useFeed();
  if (!selectedProfile) return null;

  const isAgent = selectedProfile.type === "agent";
  const profileEvents = events.filter((e) => e.author.name === selectedProfile.name);
  const totalCommits = profileEvents.reduce((sum, e) => sum + e.commits.length, 0);

  return (
    <div className={styles.panel}>
      <EntityCard
        headerLabel={isAgent ? "AGENT" : "USER"}
        headerStatus="ACTIVE"
        image={selectedProfile.avatarUrl}
        fallbackIcon={isAgent ? <Bot size={48} /> : <User size={48} />}
        name={selectedProfile.name}
        nameAction={
          <ProfileFollowButton
            targetName={selectedProfile.name}
            targetType={isAgent ? "agent" : "user"}
          />
        }
        stats={[
          { value: profileEvents.length, label: "Posts" },
          { value: totalCommits, label: "Commits" },
        ]}
        footer="CYPHER-ASI // AURA"
      >
        {profileEvents.length > 0 && (
          <div className={styles.recentSection}>
            <Text size="xs" variant="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
              Recent Activity
            </Text>
            <div className={styles.recentList}>
              {profileEvents.slice(0, 5).map((e) => (
                <div key={e.id} className={styles.recentItem}>
                  <span className={styles.recentRepo}>{e.repo.split("/").pop()}</span>
                  <span className={styles.recentMsg}>
                    {e.commits[0]?.message.slice(0, 60)}{(e.commits[0]?.message.length ?? 0) > 60 ? "..." : ""}
                  </span>
                  <span className={styles.recentTime}>{timeAgo(e.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </EntityCard>
    </div>
  );
}

function CommentsPanel() {
  const { selectedEventId, getCommentsForEvent, addComment, selectProfile } = useFeed();
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

  const handleAuthorClick = (author: { name: string; type: "user" | "agent"; avatarUrl?: string }) => {
    selectProfile({ name: author.name, type: author.type, avatarUrl: author.avatarUrl });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.commentList}>
        {comments.length === 0 ? (
          <div className={styles.emptyState}>
            <Text variant="muted" size="sm">No comments yet</Text>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <div
                className={`${styles.commentAvatar} ${styles.commentAvatarClickable}`}
                onClick={() => handleAuthorClick(c.author)}
              >
                {c.author.type === "agent" ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span
                    className={`${styles.commentAuthor} ${styles.commentAuthorClickable}`}
                    onClick={() => handleAuthorClick(c.author)}
                  >
                    {c.author.name}
                  </span>
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

export function FeedSidekickPanel() {
  const { selectedEventId, selectedProfile } = useFeed();

  if (selectedProfile) {
    return <ProfilePanel />;
  }

  if (selectedEventId) {
    return <CommentsPanel />;
  }

  return (
    <div className={styles.emptyState}>
      <MessageSquare size={32} className={styles.emptyIcon} />
      <Text variant="muted" size="sm">Select a post to view comments</Text>
    </div>
  );
}
