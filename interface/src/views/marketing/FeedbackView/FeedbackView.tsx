import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  listFeedback,
  normalizeCategory,
  normalizeSort,
  normalizeStatus,
} from "../../../api/marketing/feedback";
import { useCountUp } from "../../../hooks/use-count-up";
import { BannerCard } from "../BannerCard/BannerCard";

import { FeedbackCard } from "./FeedbackCard";
import { FeedbackFilters } from "./FeedbackFilters";
import "./FeedbackView.css";
const BANNER_COUNT_UP_DURATION_MS = 1000;

/**
 * Marketing `/feedback` page. Ported from
 * `aura-web/src/app/roadmap/page.tsx` (formerly "Roadmap") into the
 * logged-out marketing routes. Server-side `searchParams` becomes a
 * `useSearchParams()` call; the `await listFeedback(...)` call becomes a
 * React Query query so the page can re-fetch on filter changes without a
 * full reload.
 *
 * The fetch now goes to a same-origin pass-through on `aura-os-server`
 * (`GET /api/public/feedback`), which forwards to aura-network using the
 * server-side `AURA_NETWORK_URL`. The browser no longer reads any
 * upstream URL directly.
 */
export function FeedbackView(): ReactNode {
  const { t, i18n } = useTranslation("marketing");
  const statNumberFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  // Freeze the reset key at mount so the banner count-up replays only when
  // the user navigates *to* the page (a fresh mount), not on in-page filter
  // changes. Filters update the search params via `navigate(..., { replace })`,
  // which assigns a new `location.key` on every call; capturing it once keeps
  // it stable across those updates.
  const { key: locationKey } = useLocation();
  const [visitKey] = useState(() => locationKey);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t("feedback.documentTitle", {
      defaultValue: "AURA - Feedback",
    });

    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  const [searchParams] = useSearchParams();
  const sort = normalizeSort(searchParams.get("sort"));
  const category = normalizeCategory(searchParams.get("type"));
  const status = normalizeStatus(searchParams.get("status"));

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-feedback", sort, category, status],
    queryFn: () => listFeedback({ sort, category, status }),
  });

  // Summary metrics are computed from an unfiltered fetch so the banner
  // totals stay stable while the user changes the list filters. The
  // public endpoint caps results at 200 and exposes no aggregate-stats
  // route, so these are approximations over the most recent items.
  const { data: statsData, isPending: statsPending } = useQuery({
    queryKey: ["marketing-feedback-stats"],
    queryFn: () => listFeedback({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });

  const stats = useMemo(() => {
    const items = statsData ?? [];
    const resolved = items.filter(
      (item) => item.status === "done" || item.status === "deployed",
    ).length;
    const participants = new Set(
      items
        .map((item) => item.authorName)
        .filter((name): name is string => Boolean(name)),
    ).size;
    return { submitted: items.length, resolved, participants };
  }, [statsData]);

  const submittedDisplay = useCountUp({
    target: statsPending ? null : stats.submitted,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });
  const resolvedDisplay = useCountUp({
    target: statsPending ? null : stats.resolved,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });
  const participantsDisplay = useCountUp({
    target: statsPending ? null : stats.participants,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });

  const entries = data ?? [];
  const showEmpty = !isLoading && entries.length === 0;

  return (
    <section className="feedbackPage">
      <div className="feedbackBannerWrap">
        <BannerCard
          ariaLabel={t("feedback.summaryAriaLabel", {
            defaultValue: "Feedback summary",
          })}
          className="feedbackStatsCard"
        >
          <header className="feedbackStatsCardHeader">
            <h1 className="feedbackPageTitle">
              {t("feedback.title", { defaultValue: "Feedback" })}
            </h1>
            <p className="feedbackPageSubtitle">
              {t("feedback.subtitle", {
                defaultValue:
                  "Our users submit feedback and AURA autonomously improves itself.",
              })}
            </p>
          </header>

          <dl className="feedbackStatsGrid">
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">
                {t("feedback.stats.submitted", {
                  defaultValue: "Items Submitted",
                })}
              </dt>
              <dd className="feedbackStatValue">
                {statNumberFormatter.format(submittedDisplay)}
              </dd>
            </div>
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">
                {t("feedback.stats.resolved", {
                  defaultValue: "Items Resolved",
                })}
              </dt>
              <dd className="feedbackStatValue">
                {statNumberFormatter.format(resolvedDisplay)}
              </dd>
            </div>
            <div className="feedbackStat">
              <dt className="feedbackStatLabel">
                {t("feedback.stats.participants", {
                  defaultValue: "Participants",
                })}
              </dt>
              <dd className="feedbackStatValue">
                {statNumberFormatter.format(participantsDisplay)}
              </dd>
            </div>
          </dl>
        </BannerCard>
      </div>

      <div className="feedbackPageShell">
        <FeedbackFilters sort={sort} category={category} status={status} />

        <div className="feedbackListColumn">
          {entries.length > 0 ? (
            <div
              className="feedbackList"
              aria-label={t("feedback.entriesAriaLabel", {
                defaultValue: "Feedback entries",
              })}
            >
              {entries.map((entry) => (
                <FeedbackCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : showEmpty ? (
            <div className="feedbackEmptyState">
              <h2>
                {t("feedback.empty.heading", {
                  defaultValue: "No feedback yet.",
                })}
              </h2>
              <p>
                {t("feedback.empty.body", {
                  defaultValue:
                    "No AURA feedback posts match the current filters.",
                })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}