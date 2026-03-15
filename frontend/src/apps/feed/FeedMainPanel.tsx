import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { GitCommitVertical, Bot, User } from "lucide-react";
import { Lane } from "../../components/Lane";
import { useFeed } from "./FeedProvider";
import type { FeedEvent } from "./FeedProvider";
import styles from "./FeedMainPanel.module.css";

const MAX_VISIBLE_COMMITS = 3;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FeedCard({ event, isLast }: { event: FeedEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const visibleCommits = expanded
    ? event.commits
    : event.commits.slice(0, MAX_VISIBLE_COMMITS);
  const hiddenCount = event.commits.length - MAX_VISIBLE_COMMITS;

  const repoShort = event.repo.split("/").pop();
  const isAgent = event.author.type === "agent";

  return (
    <div className={styles.card}>
      <div className={styles.avatarCol}>
        <div className={styles.avatar} data-agent={isAgent}>
          {isAgent ? <Bot size={18} /> : <User size={18} />}
        </div>
        {!isLast && <div className={styles.timeline} />}
      </div>

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.authorName}>{event.author.name}</span>
          <span className={styles.action}>
            pushed {event.commits.length} commit{event.commits.length !== 1 ? "s" : ""} to{" "}
            <span className={styles.branch}>{event.branch}</span> on{" "}
            <span className={styles.repo}>{repoShort}</span>
          </span>
          <span className={styles.time}>{timeAgo(event.timestamp)}</span>
        </div>

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
              onClick={() => setExpanded(true)}
            >
              + {hiddenCount} more commit{hiddenCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function FeedMainPanel() {
  const { events } = useFeed();

  if (events.length === 0) {
    return (
      <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
        <div className={styles.empty}>
          <GitCommitVertical size={32} className={styles.emptyIcon} />
          <Text variant="muted" size="sm">No activity in your feed yet</Text>
        </div>
      </Lane>
    );
  }

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          <div className={styles.feedList}>
            {events.map((evt, i) => (
              <FeedCard
                key={evt.id}
                event={evt}
                isLast={i === events.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </Lane>
  );
}
