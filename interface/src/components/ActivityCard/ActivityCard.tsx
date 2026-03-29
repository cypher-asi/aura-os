import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { FeedEvent, FeedComment } from "../../stores/feed-store";
import { Avatar } from "../Avatar";
import { timeAgo } from "../../utils/format";
import styles from "./ActivityCard.module.css";

const MAX_VISIBLE_COMMITS = 3;

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

function PushCardBody({ event }: { event: FeedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const visibleCommits = expanded
    ? event.commits
    : event.commits.slice(0, MAX_VISIBLE_COMMITS);
  const hiddenCount = event.commits.length - MAX_VISIBLE_COMMITS;
  const repoShort = event.repo.split("/").pop();

  return (
    <>
      <span className={styles.action}>
        Pushed {event.commits.length} commit{event.commits.length !== 1 ? "s" : ""} to{" "}
        <span className={styles.branch}>{event.branch}</span> on{" "}
        <span className={styles.repo}>{repoShort}</span>
      </span>

      {event.summary && <p className={styles.summary}>{event.summary}</p>}

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
    </>
  );
}

function PostCardBody({ event }: { event: FeedEvent }) {
  return (
    <>
      {event.title && <p className={styles.postTitle}>{event.title}</p>}
      {event.summary && <p className={styles.summary}>{event.summary}</p>}
    </>
  );
}

function EventCardBody({ event }: { event: FeedEvent }) {
  return (
    <>
      <div className={styles.action}>
        {event.eventType && <span className={styles.eventBadge}>{event.eventType}</span>}
      </div>
      {event.title && <p className={styles.postTitle}>{event.title}</p>}
      {event.summary && <p className={styles.summary}>{event.summary}</p>}
    </>
  );
}

export function ActivityCard({ event, isLast, isSelected, comments, onSelect, onSelectProfile }: ActivityCardProps) {
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
          status={event.author.status}
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

          {event.postType === "push" && <PushCardBody event={event} />}
          {event.postType === "post" && <PostCardBody event={event} />}
          {event.postType === "event" && <EventCardBody event={event} />}
        </div>

        <CommentPreview comments={comments} onClick={() => onSelect(event.id)} />
      </div>
    </div>
  );
}
