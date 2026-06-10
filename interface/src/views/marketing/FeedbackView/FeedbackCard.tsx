import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { FeedbackEntry } from "../../../api/marketing/feedback";
import { CATEGORY_LABELS, STATUS_LABELS } from "./feedback-constants";

function timeAgo(iso: string, t: TFunction<"marketing">): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) {
    return t("feedback.card.time.secondsAgo", {
      defaultValue: `${sec}s ago`,
      count: sec,
    });
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return t("feedback.card.time.minutesAgo", {
      defaultValue: `${min}m ago`,
      count: min,
    });
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return t("feedback.card.time.hoursAgo", {
      defaultValue: `${hr}h ago`,
      count: hr,
    });
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return t("feedback.card.time.daysAgo", {
      defaultValue: `${day}d ago`,
      count: day,
    });
  }
  const mo = Math.floor(day / 30);
  if (mo < 12) {
    return t("feedback.card.time.monthsAgo", {
      defaultValue: `${mo}mo ago`,
      count: mo,
    });
  }
  const yr = Math.floor(day / 365);
  return t("feedback.card.time.yearsAgo", {
    defaultValue: `${yr}y ago`,
    count: yr,
  });
}

export interface FeedbackCardProps {
  readonly entry: FeedbackEntry;
}

export function FeedbackCard({ entry }: FeedbackCardProps): ReactNode {
  const { t } = useTranslation("marketing");
  const authorName =
    entry.authorName ??
    t("feedback.card.anonymousAuthor", { defaultValue: "Anonymous" });
  const categoryFallback = CATEGORY_LABELS[entry.category] ?? entry.category;
  const statusFallback = STATUS_LABELS[entry.status] ?? entry.status;
  const category = t(`feedback.filters.category.${entry.category}`, {
    defaultValue: categoryFallback,
  });
  const status = t(`feedback.filters.status.${entry.status}`, {
    defaultValue: statusFallback,
  });

  return (
    <article className="feedbackCard">
      <div
        className="feedbackCardVotes"
        aria-label={t("feedback.card.voteScoreAriaLabel", {
          defaultValue: "Vote score",
        })}
      >
        <span className="feedbackCardVoteIcon" aria-hidden>
          <ChevronUp size={16} strokeWidth={1.75} />
        </span>
        <span className="feedbackCardVoteScore">{entry.voteScore}</span>
        <span className="feedbackCardVoteIcon" aria-hidden>
          <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </div>

      <div className="feedbackCardBody">
        <div className="feedbackCardHeader">
          <span className="feedbackCardAuthor">{authorName}</span>
          <span className="feedbackCardDot" aria-hidden>
            &middot;
          </span>
          <span className="feedbackCardTime">
            {timeAgo(entry.createdAt, t)}
          </span>
          <span className="feedbackCardCategoryGroup">
            <span className="feedbackCardDot" aria-hidden>
              &middot;
            </span>
            <span className="feedbackCardCategory">{category}</span>
          </span>
          <span className="feedbackCardHeaderSpacer" />
          <span className="feedbackCardStatus" data-status={entry.status}>
            {status}
          </span>
        </div>

        <h3 className="feedbackCardTitle">{entry.title}</h3>
        {entry.body ? (
          <p className="feedbackCardPreview">{entry.body}</p>
        ) : null}

        {entry.commentCount > 0 ? (
          <div className="feedbackCardMeta">
            <MessageSquare size={12} strokeWidth={1.75} />
            {t("feedback.card.commentCount", {
              defaultValue:
                entry.commentCount === 1
                  ? "1 comment"
                  : `${entry.commentCount} comments`,
              count: entry.commentCount,
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}