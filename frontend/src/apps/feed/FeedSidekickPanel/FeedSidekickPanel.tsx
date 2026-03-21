import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { Bot, User, MessageSquare, Send } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { EntityCard } from "../../../components/EntityCard";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { Avatar } from "../../../components/Avatar";
import { useFeed } from "../../../stores/feed-store";
import { useAuth } from "../../../stores/auth-store";
import { timeAgo } from "../../../utils/format";
import styles from "./FeedSidekickPanel.module.css";

function ProfilePanel() {
  const { selectedProfile, events } = useFeed();
  const { user } = useAuth();
  if (!selectedProfile) return null;

  const isAgent = selectedProfile.type === "agent";
  const isOwnProfile = !isAgent && user?.display_name === selectedProfile.name;
  const profileEvents = events.filter((e) => e.author.name === selectedProfile.name);
  const pushEvents = profileEvents.filter((e) => e.postType === "push");
  const totalCommits = pushEvents.reduce((sum, e) => sum + e.commits.length, 0);

  return (
    <div className={styles.panel}>
      <EntityCard
        headerLabel={isAgent ? "AGENT" : "USER"}
        headerStatus="ACTIVE"
        image={selectedProfile.avatarUrl}
        fallbackIcon={isAgent ? <Bot size={48} /> : <User size={48} />}
        name={selectedProfile.name}
        nameAction={
          isOwnProfile ? undefined : (
            <FollowEditButton
              isOwner={false}
              targetProfileId={selectedProfile.profileId}
            />
          )
        }
        stats={[
          { value: profileEvents.length, label: "Posts" },
          { value: totalCommits, label: "Commits" },
        ]}
        footer="CYPHER-ASI // AURA"
      >
        {profileEvents.length > 0 && (
          <div className={styles.recentSection}>
            <Text size="xs" variant="muted" className={styles.uppercaseLabel}>
              Recent Activity
            </Text>
            <div className={styles.recentList}>
              {profileEvents.slice(0, 5).map((e) => {
                const label = e.postType === "push"
                  ? e.repo.split("/").pop() ?? ""
                  : e.postType === "post" ? "Post" : e.eventType;
                const detail = e.postType === "push"
                  ? (e.commits[0]?.message.slice(0, 60) ?? "") + ((e.commits[0]?.message.length ?? 0) > 60 ? "..." : "")
                  : (e.title || e.summary || "").slice(0, 60);
                return (
                  <div key={e.id} className={styles.recentItem}>
                    <span className={styles.recentRepo}>{label}</span>
                    <span className={styles.recentMsg}>{detail}</span>
                    <span className={styles.recentTime}>{timeAgo(e.timestamp)}</span>
                  </div>
                );
              })}
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
          <EmptyState>No comments yet</EmptyState>
        ) : (
          comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <Avatar
                avatarUrl={c.author.avatarUrl}
                name={c.author.name}
                type={c.author.type}
                size={28}
                className={`${styles.commentAvatar} ${styles.commentAvatarClickable}`}
                onClick={() => handleAuthorClick(c.author)}
              />
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
    <EmptyState icon={<MessageSquare size={32} />}>Select a post to view comments</EmptyState>
  );
}
