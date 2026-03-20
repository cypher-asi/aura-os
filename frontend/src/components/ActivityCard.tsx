/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { FeedEvent, FeedComment } from "../apps/feed/FeedProvider";
import { Avatar } from "./Avatar";
import styles from "./ActivityCard.module.css";

const MAX_VISIBLE_COMMITS = 3;

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CommentPreview({ comments, onClick }: { comments: FeedComment[]; onClick: () => void }) {
  if (comments.length === 0) return null;

  const uniqueAuthors = [...new Map(comments.map((c) => [c.author.name, c.author])).values()].slice(0, 3);

  return (
    <button className={styles.commentPreview} onClick={onClick}>
      <div className={styles.commentAvatarStack}>
        {uniqueAuthors.map((author, i) => (
          <Avatar
            key={author.name}
            avatarUrl={author.avatarUrl}
            name={author.name}
            type={author.type}
            size={20}
            className={styles.commentAvatar}
            style={{ zIndex: uniqueAuthors.length - i }}
          />
        ))}
      </div>
      <span className={styles.commentCount}>
        <MessageSquare size={12} />
        {comments.length} comment{comments.length !== 1 ? "s" : ""}
      </span>
    </button>
  );
}

export interface ActivityCardProps {
  event: FeedEvent;
  isLast: boolean;
  isSelected: boolean;
  comments: FeedComment[];
  onSelect: (id: string) => void;
  onSelectProfile?: (author: { name: string; type: "user" | "agent"; avatarUrl?: string }) => void;
}

export function ActivityCard({ event, isLast, isSelected, comments, onSelect, onSelectProfile }: ActivityCardProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleCommits = expanded
    ? event.commits
    : event.commits.slice(0, MAX_VISIBLE_COMMITS);
  const hiddenCount = event.commits.length - MAX_VISIBLE_COMMITS;

  const repoShort = event.repo.split("/").pop();

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectProfile?.(event.author);
  };

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardActive : ""}`}
      onClick={() => onSelect(event.id)}
    >
      <div className={styles.avatarCol}>
        <Avatar
          avatarUrl={event.author.avatarUrl}
          name={event.author.name}
          type={event.author.type}
          size={36}
          className={`${styles.avatar} ${onSelectProfile ? styles.avatarClickable : ""}`}
          onClick={handleAvatarClick}
        />
        {!isLast && <div className={styles.timeline} />}
      </div>

      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles.headerLine}>
            <span className={styles.authorName}>{event.author.name}</span>
            <span className={styles.headerDot}>&middot;</span>
            <span className={styles.time}>{timeAgo(event.timestamp)}</span>
          </div>
          <span className={styles.action}>
            Pushed {event.commits.length} commit{event.commits.length !== 1 ? "s" : ""} to{" "}
            <span className={styles.branch}>{event.branch}</span> on{" "}
            <span className={styles.repo}>{repoShort}</span>
          </span>
        </div>

        {event.summary && (
          <p className={styles.summary}>{event.summary}</p>
        )}

        <div className={styles.commits}>
          {visibleCommits.map((c) => (
            <div key={c.sha} className={styles.commit}>
              <span className={styles.sha}>{c.sha.slice(0, 7)}</span>
              <span className={styles.commitMsg}>{c.message}</span>
            </div>
          ))}
          {!expanded && hiddenCount > 0 && (
            <button
              className={styles.moreCommits}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
            >
              + {hiddenCount} more commit{hiddenCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        <CommentPreview comments={comments} onClick={() => onSelect(event.id)} />
      </div>
    </div>
  );
}
