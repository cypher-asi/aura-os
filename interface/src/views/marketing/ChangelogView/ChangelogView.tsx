import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  type ChangelogEntry,
  type ChangelogTimelineMedia,
  fetchChangelogEntries,
} from "../../../api/marketing/changelog";
import {
  AURA_PUBLIC_REPOS,
  fetchAuraCommitStats,
  type LiveCommitStats,
} from "../../../api/marketing/github-commits";
import {
  type DesktopManifestChannel,
  DESKTOP_MANIFEST_CHANNELS,
  fetchDesktopManifest,
  resolveAutoDownloadUrl,
} from "../../../api/marketing/desktop-manifest";
import {
  detectDownloadPlatform,
  type DownloadPlatform,
} from "../../../lib/download-targets";
import { useCountUp } from "../../../hooks/use-count-up";
import { useRelativeTime } from "../../../hooks/use-relative-time";
import { BannerCard } from "../BannerCard/BannerCard";
import "./ChangelogView.css";

const DOWNLOAD_FALLBACK_PATH = "/download";

function normalizeManifestChannel(
  channel: string | undefined,
): DesktopManifestChannel {
  if (channel && (DESKTOP_MANIFEST_CHANNELS as readonly string[]).includes(channel)) {
    return channel as DesktopManifestChannel;
  }
  return "nightly";
}

const BANNER_COUNT_UP_DURATION_MS = 1000;

/** Placeholder shown when commit totals can't be resolved and no
 *  last-known value is cached, so the card never reports a bogus `0`. */
const STAT_UNAVAILABLE = "\u2014";

const COMMIT_STATS_STORAGE_KEY = "aura.changelog.commitStats.v2";

interface CommitTotals {
  readonly commitsThisMonth: number;
  readonly commitsAllTime: number;
  /** GitHub release counts for `aura-os`, when the snapshot carries them.
   *  `releasesThisMonth` is gated on `monthKey` like the commit figure. */
  readonly releasesThisMonth?: number;
  readonly releasesAllTime?: number;
  /** PST `YYYY-MM` the `commitsThisMonth` figure belongs to. */
  readonly monthKey: string;
}

/**
 * Live commit stats are usable only when the all-time total resolved to
 * a positive number. A zero all-time across every public repo means the
 * upstream fetch degraded (rate limit / outage) rather than a real
 * count, so we treat it as "unavailable" and fall back to the last-known
 * cached value instead of rendering 0.
 */
function commitStatsUsable(
  stats: LiveCommitStats | undefined,
): stats is LiveCommitStats {
  return Boolean(stats && stats.commitsAllTime > 0);
}

function readStoredCommitTotals(): CommitTotals | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COMMIT_STATS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CommitTotals>;
    if (
      typeof parsed.commitsThisMonth === "number" &&
      typeof parsed.commitsAllTime === "number"
    ) {
      return {
        commitsThisMonth: parsed.commitsThisMonth,
        commitsAllTime: parsed.commitsAllTime,
        ...(typeof parsed.releasesThisMonth === "number"
          ? { releasesThisMonth: parsed.releasesThisMonth }
          : {}),
        ...(typeof parsed.releasesAllTime === "number"
          ? { releasesAllTime: parsed.releasesAllTime }
          : {}),
        monthKey: typeof parsed.monthKey === "string" ? parsed.monthKey : "",
      };
    }
  } catch {
    // Corrupt JSON or storage disabled (privacy mode) — no cached value.
  }
  return null;
}

function writeStoredCommitTotals(totals: CommitTotals): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMMIT_STATS_STORAGE_KEY,
      JSON.stringify(totals),
    );
  } catch {
    // Quota exceeded / privacy mode — caching is best-effort, skip.
  }
}

const CHANGELOG_TIME_ZONE = "America/Los_Angeles";

const PST_MONTH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHANGELOG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

/**
 * "Current month" key in `YYYY-MM` form, anchored to America/Los_Angeles
 * so it lines up with the PST calendar dates the API helper bakes into
 * `entry.date` (see `toPstCalendarDate` in `api/marketing/changelog.ts`).
 * `en-CA` is used because it emits the ISO-like `YYYY-MM` literal we want
 * out of the box.
 */
function getCurrentPstMonthKey(now: Date = new Date()): string {
  return PST_MONTH_FORMATTER.format(now);
}

interface ChangelogStats {
  readonly releasesThisMonth: number;
  readonly releasesAllTime: number;
}

interface ReleasesPerDayPoint {
  readonly date: string;
  readonly releases: number;
}

function entryReleases(entry: ChangelogEntry): number {
  return entry.rendered.entries.length;
}

function computeStats(
  entries: readonly ChangelogEntry[],
  monthKey: string,
): ChangelogStats {
  const thisMonth = entries.filter((entry) => entry.date.startsWith(monthKey));
  return {
    releasesThisMonth: thisMonth.reduce((n, e) => n + entryReleases(e), 0),
    releasesAllTime: entries.reduce((n, e) => n + entryReleases(e), 0),
  };
}

function computeReleasesPerDay(
  entries: readonly ChangelogEntry[],
): readonly ReleasesPerDayPoint[] {
  return [...entries]
    .map((entry) => ({ date: entry.date, releases: entryReleases(entry) }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function formatStatLabel(date: string, language: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

interface ReleasesPerDayChartProps {
  readonly series: readonly ReleasesPerDayPoint[];
}

/**
 * Tiny inline-SVG bar chart of releases-per-day, chronological ascending.
 * Avoids pulling in a charting dependency for what's essentially ~15 bars
 * of context next to the stat grid. Bars normalize against the dataset's
 * max release count; the most recent day gets a brighter accent fill so
 * it reads as "today".
 */
function ReleasesPerDayChart({
  series,
}: ReleasesPerDayChartProps): ReactNode {
  const { t, i18n } = useTranslation("marketing");
  // `useId` / `useState` run before the early return so hook order stays
  // stable across renders regardless of whether the dataset is empty on
  // first paint.
  const reactId = useId();
  const gradientId = `${reactId}-bar-fill`;
  const glowId = `${reactId}-bar-glow`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (series.length === 0) {
    return null;
  }

  const viewWidth = 260;
  const viewHeight = 96;
  const gap = 2;
  const barWidth = Math.max((viewWidth - gap * (series.length - 1)) / series.length, 1);
  const max = series.reduce((acc, point) => Math.max(acc, point.releases), 0);
  const lastIndex = series.length - 1;

  const hoveredPoint =
    hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < series.length
      ? series[hoveredIndex]
      : null;

  // When a bar is hovered the caption swaps to show that bar's release
  // count + date so the user gets immediate textual feedback without the
  // ~500ms delay the native SVG `<title>` tooltip imposes. The bar itself
  // still brightens via `:hover` so the visual "which one" + textual
  // "how many" channels reinforce each other.
  const caption = hoveredPoint
    ? t("changelog.chart.captionWithCount", {
        defaultValue:
          hoveredPoint.releases === 1
            ? `1 release · ${formatStatLabel(hoveredPoint.date, i18n.language)}`
            : `${hoveredPoint.releases} releases · ${formatStatLabel(
                hoveredPoint.date,
                i18n.language,
              )}`,
        count: hoveredPoint.releases,
        date: formatStatLabel(hoveredPoint.date, i18n.language),
      })
    : t("changelog.chart.caption", { defaultValue: "Releases per day" });

  return (
    <div
      className="changelogStatsChartWrap"
      data-hovered={hoveredPoint !== null ? "true" : "false"}
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <span
        className="changelogStatsChartCaption"
        role="status"
        aria-live="polite"
      >
        {caption}
      </span>
    <svg
      className="changelogStatsChart"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("changelog.chart.ariaLabel", {
        defaultValue: "Releases per day over time",
      })}
    >
      <defs>
        {/*
         * Gradient is anchored to the CHART (userSpaceOnUse with y1 at the
         * baseline and y2 at the top) instead of each rect's bounding box.
         * That makes magnitude drive color naturally: short bars sit in
         * the basement purple while tall bars rise into the bright pink
         * crest. One definition, no per-bar color math.
         *
         * The basement color is tuned to harmonize with the stats card's
         * radial gradient backdrop (`#3e0e72` -> `#170338`, see
         * `.changelogStatsCard` in ChangelogView.css) rather than fight
         * it. The previous `#3b0a5a` leaned slightly more magenta than
         * the card's bluer purples and visually clashed against the
         * lower-left dark zone where the chart sits; `#55168a` matches
         * the card hue family while staying bright enough to read
         * against the `#220650`-ish backdrop.
         */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={viewHeight}
          x2={0}
          y2={0}
        >
          <stop offset="0%" stopColor="#55168a" />
          <stop offset="30%" stopColor="#6b1ea1" />
          <stop offset="65%" stopColor="#c43c9a" />
          <stop offset="100%" stopColor="#ff64c8" />
        </linearGradient>
        {/*
         * Soft pink halo applied only to the latest bar so "today" still
         * pops without resorting to a brighter fill that would break the
         * gradient palette.
         */}
        <filter
          id={glowId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {series.map((point, index) => {
        const ratio = max > 0 ? point.releases / max : 0;
        const barHeight = Math.max(ratio * viewHeight, point.releases > 0 ? 2 : 0);
        const x = index * (barWidth + gap);
        const y = viewHeight - barHeight;
        const isLatest = index === lastIndex;
        return (
          <rect
            key={`${point.date}-${index}`}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={1}
            fill={`url(#${gradientId})`}
            filter={isLatest ? `url(#${glowId})` : undefined}
            className={
              isLatest
                ? "changelogStatsChartBar changelogStatsChartBarLatest"
                : "changelogStatsChartBar"
            }
            onPointerEnter={() => setHoveredIndex(index)}
          >
            <title>
              {t("changelog.chart.barTitle", {
                defaultValue:
                  point.releases === 1
                    ? `${formatStatLabel(point.date, i18n.language)}: 1 release`
                    : `${formatStatLabel(point.date, i18n.language)}: ${
                        point.releases
                      } releases`,
                count: point.releases,
                date: formatStatLabel(point.date, i18n.language),
              })}
            </title>
          </rect>
        );
      })}
    </svg>
    </div>
  );
}

function formatDateLabel(value: string, language: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(language, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatTimelineTime(
  value: string,
  fallbackLabel: string,
  language: string,
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackLabel;
  }

  try {
    return new Intl.DateTimeFormat(language, {
      timeZone: CHANGELOG_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "shortGeneric",
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat(language, {
      timeZone: CHANGELOG_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(parsed);
  }
}

function getCommitUrl(repo: string, sha: string): string {
  return `https://github.com/cypher-asi/${repo}/commit/${sha}`;
}

function getMediaAltText(title: string, alt: string | undefined): string {
  return alt?.trim() || `${title} screenshot`;
}

/**
 * Marketing `/changelog` page. Ported from
 * `aura-web/src/app/changelog/page.tsx` as a client component that uses
 * React Query against the new `api/marketing/changelog` helper instead
 * of the Next.js `async` server component. Page chrome (public-mode
 * `AuraShell` + `PublicMarketingPanel` scroll column) is owned by the
 * parent route.
 */
export function ChangelogView(): ReactNode {
  const { t, i18n } = useTranslation("marketing");
  const statNumberFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  const commitsLiveTitle = t("changelog.commitsLiveTitle", {
    defaultValue: `Live total across ${AURA_PUBLIC_REPOS.length} AURA repositories`,
    count: AURA_PUBLIC_REPOS.length,
  });
  const { key: visitKey } = useLocation();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t("changelog.documentTitle", {
      defaultValue: "AURA - Changelog",
    });

    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketing-changelog"],
    queryFn: fetchChangelogEntries,
  });

  // Commit totals across the 7 public AURA repos, read from the static
  // `commit-stats.json` snapshot published to gh-pages by the release CI
  // run. Kept separate from the curated changelog query because it's
  // independent and shouldn't block the page on cold load.
  const {
    data: liveCommitStats,
    isLoading: commitStatsLoading,
  } = useQuery({
    queryKey: ["marketing-changelog-live-commits"],
    queryFn: ({ signal }) => fetchAuraCommitStats(signal),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Last-known-good totals persisted across visits so a transient
  // upstream outage shows the previous real numbers instead of dropping
  // back to a placeholder. Seeded synchronously from localStorage on
  // mount.
  const [storedCommitTotals, setStoredCommitTotals] = useState<
    CommitTotals | null
  >(() => readStoredCommitTotals());

  useEffect(() => {
    if (!commitStatsUsable(liveCommitStats)) return;
    const totals: CommitTotals = {
      commitsThisMonth: liveCommitStats.commitsThisMonth,
      commitsAllTime: liveCommitStats.commitsAllTime,
      ...(typeof liveCommitStats.releasesThisMonth === "number"
        ? { releasesThisMonth: liveCommitStats.releasesThisMonth }
        : {}),
      ...(typeof liveCommitStats.releasesAllTime === "number"
        ? { releasesAllTime: liveCommitStats.releasesAllTime }
        : {}),
      monthKey: liveCommitStats.monthKey,
    };
    writeStoredCommitTotals(totals);
    setStoredCommitTotals(totals);
  }, [liveCommitStats]);

  // Prefer fresh usable stats; otherwise fall back to the last-known
  // cached totals. Null only when we have neither.
  const effectiveCommitTotals: CommitTotals | null = commitStatsUsable(
    liveCommitStats,
  )
    ? {
        commitsThisMonth: liveCommitStats.commitsThisMonth,
        commitsAllTime: liveCommitStats.commitsAllTime,
        ...(typeof liveCommitStats.releasesThisMonth === "number"
          ? { releasesThisMonth: liveCommitStats.releasesThisMonth }
          : {}),
        ...(typeof liveCommitStats.releasesAllTime === "number"
          ? { releasesAllTime: liveCommitStats.releasesAllTime }
          : {}),
        monthKey: liveCommitStats.monthKey,
      }
    : storedCommitTotals;

  // While the first fetch is in flight (and nothing cached) the count
  // holds at 0 with `aria-busy`. Once the query settles without usable
  // data and there's no cached fallback, render a dash instead of 0.
  const commitStatsUnavailable =
    !effectiveCommitTotals && !commitStatsLoading;

  // "Commits this month" is only meaningful when the snapshot's PST month
  // matches the current PST month. After a month rollover (before the
  // first new-month release republishes the snapshot) the carried-over
  // figure is last month's, so we show 0 for this-month instead of the
  // stale count — mirroring "releases this month", which is likewise 0
  // until the first push of the month lands and updates the snapshot.
  // All-time is always safe to show.
  const currentMonthKey = getCurrentPstMonthKey();
  const thisMonthIsCurrent = Boolean(
    effectiveCommitTotals && effectiveCommitTotals.monthKey === currentMonthKey,
  );

  // Stabilize the empty fallback so memo deps below don't change every
  // render (React Query keeps `data` referentially stable across renders
  // until it refetches, but `?? []` would allocate a new array each time).
  const entries = useMemo<readonly ChangelogEntry[]>(() => data ?? [], [data]);
  const latestVersion = entries.find((entry) => entry.version)?.version;
  // Entries are sorted by date descending in `fetchChangelogEntries`, so
  // `entries[0]` is always the most recent release. Drive the relative
  // time off `generatedAt` because it's the wall-clock timestamp of when
  // the release was actually published, whereas `entry.date` is just
  // the PST calendar bucket.
  const latestRelease = entries[0];
  const latestReleaseAgo = useRelativeTime(latestRelease?.generatedAt);
  const renderEmpty = !isLoading && !isError && entries.length === 0;

  // Prefetch the desktop manifest for the latest release's channel so
  // clicking the version-name auto-download button can resolve the
  // OS-specific installer URL instantly. Falls back transparently to
  // the entry's own `releaseUrl` when the manifest isn't reachable.
  const manifestChannel = normalizeManifestChannel(latestRelease?.channel);
  const { data: desktopManifest } = useQuery({
    queryKey: ["marketing-changelog-desktop-manifest", manifestChannel],
    queryFn: ({ signal }) => fetchDesktopManifest(manifestChannel, signal),
    enabled: Boolean(latestRelease),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleVersionAutoDownload = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const platform: DownloadPlatform = detectDownloadPlatform();
    const destination = resolveAutoDownloadUrl(
      desktopManifest,
      platform,
      latestRelease?.releaseUrl ?? null,
    );
    window.location.href = destination ?? DOWNLOAD_FALLBACK_PATH;
  }, [desktopManifest, latestRelease]);

  const stats = useMemo(
    () => computeStats(entries, getCurrentPstMonthKey()),
    [entries],
  );
  const releasesPerDay = useMemo(
    () => computeReleasesPerDay(entries),
    [entries],
  );

  // Release counts prefer the CI-published snapshot (refreshed on every
  // push to main, so it stays current between releases) and fall back to
  // the changelog-index-derived figures when the snapshot predates
  // release tracking. "This month" is gated on the snapshot's month
  // matching the current PST month, mirroring the commit figure.
  const snapshotReleasesThisMonth =
    thisMonthIsCurrent &&
    effectiveCommitTotals &&
    typeof effectiveCommitTotals.releasesThisMonth === "number"
      ? effectiveCommitTotals.releasesThisMonth
      : null;
  const snapshotReleasesAllTime =
    effectiveCommitTotals &&
    typeof effectiveCommitTotals.releasesAllTime === "number"
      ? effectiveCommitTotals.releasesAllTime
      : null;

  // Count every summary stat up from 0 on each visit. Targets stay null
  // while their query is pending so the value holds at 0 during fetch;
  // once a finite total arrives it counts up from 0 to the real number.
  const releasesThisMonthDisplay = useCountUp({
    target:
      snapshotReleasesThisMonth !== null
        ? snapshotReleasesThisMonth
        : isLoading
          ? null
          : stats.releasesThisMonth,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });
  const releasesAllTimeDisplay = useCountUp({
    target:
      snapshotReleasesAllTime !== null
        ? snapshotReleasesAllTime
        : isLoading
          ? null
          : stats.releasesAllTime,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });
  const commitsThisMonthDisplay = useCountUp({
    target:
      thisMonthIsCurrent && effectiveCommitTotals
        ? effectiveCommitTotals.commitsThisMonth
        : null,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });
  const commitsAllTimeDisplay = useCountUp({
    target: effectiveCommitTotals ? effectiveCommitTotals.commitsAllTime : null,
    resetKey: visitKey,
    durationMs: BANNER_COUNT_UP_DURATION_MS,
  });

  return (
    <section className="changelogPage">
      <div className="changelogPageShell">
        <BannerCard
          ariaLabel={t("changelog.summaryAriaLabel", {
            defaultValue: "Changelog summary",
          })}
          className="changelogStatsCard"
        >
          <header className="changelogStatsCardHeader">
            <h1 className="changelogPageTitle">
              {t("changelog.title", { defaultValue: "Changelog" })}
            </h1>
            {(latestVersion || latestRelease) ? (
              <div className="changelogStat changelogStatVersion">
                <span className="changelogStatLabel">
                  {t("changelog.currentVersion", {
                    defaultValue: "Current version",
                  })}
                </span>
                {latestVersion ? (
                  <button
                    type="button"
                    className="changelogStatValue changelogStatValueButton"
                    onClick={handleVersionAutoDownload}
                    aria-label={t("changelog.downloadVersionAriaLabel", {
                      defaultValue: `Download AURA ${latestVersion} for your operating system`,
                      version: latestVersion,
                    })}
                    title={t("changelog.downloadVersionTitle", {
                      defaultValue:
                        "Click to download the build for your operating system",
                    })}
                  >
                    {latestVersion}
                  </button>
                ) : (
                  <span className="changelogStatValue">—</span>
                )}
                {latestRelease ? (
                  <div className="changelogStatVersionMeta">
                    <time
                      className="changelogStatVersionTime"
                      dateTime={latestRelease.generatedAt}
                      title={new Date(
                        latestRelease.generatedAt,
                      ).toLocaleString()}
                    >
                      {latestReleaseAgo
                        ? t("changelog.releasedAgo", {
                            defaultValue: `Released ${latestReleaseAgo}`,
                            relativeTime: latestReleaseAgo,
                          })
                        : t("changelog.releasedRecently", {
                            defaultValue: "Released recently",
                          })}
                    </time>
                    <div className="changelogStatVersionActions">
                      <Link
                        to="/download"
                        className="changelogStatVersionLink"
                      >
                        {t("changelog.download", { defaultValue: "Download" })}
                        <span aria-hidden="true">&nbsp;&rarr;</span>
                      </Link>
                      <a
                        href="https://github.com/cypher-asi/aura-os"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="changelogStatVersionLink"
                      >
                        {t("changelog.github", { defaultValue: "GitHub" })}
                        <span aria-hidden="true">&nbsp;&rarr;</span>
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>

          <div className="changelogStatsCardBody">
            <dl className="changelogStatsGrid">
              <div className="changelogStat">
                <dt className="changelogStatLabel">
                  {t("changelog.stats.releasesThisMonth", {
                    defaultValue: "Releases this month",
                  })}
                </dt>
                <dd className="changelogStatValue">
                  {statNumberFormatter.format(releasesThisMonthDisplay)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">
                  {t("changelog.stats.commitsThisMonth", {
                    defaultValue: "Commits this month",
                  })}
                </dt>
                <dd
                  className="changelogStatValue"
                  aria-live="polite"
                  aria-busy={commitStatsLoading ? "true" : "false"}
                  title={commitsLiveTitle}
                >
                  {commitStatsUnavailable
                    ? STAT_UNAVAILABLE
                    : statNumberFormatter.format(commitsThisMonthDisplay)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">
                  {t("changelog.stats.allTimeReleases", {
                    defaultValue: "All-time releases",
                  })}
                </dt>
                <dd className="changelogStatValue">
                  {statNumberFormatter.format(releasesAllTimeDisplay)}
                </dd>
              </div>
              <div className="changelogStat">
                <dt className="changelogStatLabel">
                  {t("changelog.stats.allTimeCommits", {
                    defaultValue: "All-time commits",
                  })}
                </dt>
                <dd
                  className="changelogStatValue"
                  aria-live="polite"
                  aria-busy={commitStatsLoading ? "true" : "false"}
                  title={commitsLiveTitle}
                >
                  {commitStatsUnavailable
                    ? STAT_UNAVAILABLE
                    : statNumberFormatter.format(commitsAllTimeDisplay)}
                </dd>
              </div>
            </dl>

            <ReleasesPerDayChart series={releasesPerDay} />
          </div>
        </BannerCard>

        {entries.length > 0 ? (
          <div
            className="changelogEntries"
            aria-label={t("changelog.entriesAriaLabel", {
              defaultValue: "Aura changelog entries",
            })}
          >
            {entries.map((entry) => {
              const entryKey = `${entry.date}-${entry.version ?? entry.generatedAt}`;
              const releaseCount = entry.rendered.entries.length;
              const commitCount =
                entry.filteredCommitCount ?? entry.rawCommitCount;
              const highlights = Array.from(new Set(entry.rendered.highlights));

              return (
                <article key={entryKey} className="changelogEntry">
                  <time
                    className="changelogEntryDate"
                    dateTime={entry.date}
                  >
                    {formatDateLabel(entry.date, i18n.language)}
                  </time>

                  <div className="changelogEntryBody">
                    <div className="changelogEntryHead">
                      <div className="changelogEntryMeta">
                        <span>{entry.channel}</span>
                        <span>
                          {t("changelog.entry.releaseCount", {
                            defaultValue:
                              releaseCount === 1
                                ? "1 release"
                                : `${releaseCount} releases`,
                            count: releaseCount,
                          })}
                        </span>
                        <span>
                          {t("changelog.entry.commitCount", {
                            defaultValue:
                              commitCount === 1
                                ? "1 commit"
                                : `${commitCount} commits`,
                            count: commitCount,
                          })}
                        </span>
                      </div>

                      {highlights.length > 0 && (
                        <section
                          className="changelogTldr"
                          aria-label={t("changelog.dailyUpdate", {
                            defaultValue: "Daily Update",
                          })}
                        >
                          <h2 className="changelogTldrLabel">
                            {t("changelog.dailyUpdate", {
                              defaultValue: "Daily Update",
                            })}
                          </h2>
                          <ol className="changelogTldrList">
                            {highlights.map((highlight, highlightIndex) => (
                              <li
                                key={highlight}
                                className="changelogTldrItem"
                              >
                                <span className="changelogTldrItemNumber">
                                  {highlightIndex + 1}.
                                </span>
                                <span>{highlight}</span>
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}
                    </div>

                    <div className="changelogEntryTimeline">
                      {entry.rendered.entries.map(
                        (timelineEntry, timelineIndex) => {
                          const media: ChangelogTimelineMedia | undefined =
                            timelineEntry.media?.status === "published" &&
                            timelineEntry.media.assetUrl
                              ? timelineEntry.media
                              : undefined;

                          return (
                            <section
                              key={`${entryKey}-${timelineIndex}-${timelineEntry.started_at}`}
                              className="changelogTimelineItem"
                            >
                              <span className="changelogSectionTime">
                                {formatTimelineTime(
                                  timelineEntry.started_at,
                                  timelineEntry.time_label,
                                  i18n.language,
                                )}
                              </span>
                              <div className="changelogSection">
                                <h3 className="changelogSectionTitle">
                                  {timelineEntry.title}
                                </h3>
                                <p className="changelogSectionSummary">
                                  {timelineEntry.summary}
                                </p>
                                {media && (
                                  <figure className="changelogSectionMedia">
                                    <a
                                      href={media.assetUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="changelogSectionMediaLink"
                                      aria-label={t(
                                        "changelog.openScreenshotAriaLabel",
                                        {
                                          defaultValue: `Open screenshot for ${timelineEntry.title}`,
                                          title: timelineEntry.title,
                                        },
                                      )}
                                    >
                                      <img
                                        src={media.assetUrl}
                                        alt={getMediaAltText(
                                          timelineEntry.title,
                                          media.alt,
                                        )}
                                        className="changelogSectionMediaImage"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    </a>
                                  </figure>
                                )}
                                {timelineEntry.items.length > 0 && (
                                  <ul className="changelogSectionList">
                                    {timelineEntry.items.map(
                                      (item, itemIndex) => (
                                        <li
                                          key={`${timelineEntry.title}-${itemIndex}`}
                                          className="changelogSectionItem"
                                        >
                                          <p>{item.text}</p>
                                          {item.commit_shas.length > 0 && (
                                            <div className="changelogSectionSources">
                                              <span className="changelogSectionSourcesLabel">
                                                {t("changelog.sources", {
                                                  defaultValue: "Sources",
                                                })}
                                              </span>
                                              {item.commit_shas.map((sha) => (
                                                <a
                                                  key={sha}
                                                  href={getCommitUrl(
                                                    entry.repo,
                                                    sha,
                                                  )}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="changelogSectionCommitLink"
                                                >
                                                  {sha.slice(0, 7)}
                                                </a>
                                              ))}
                                            </div>
                                          )}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                              </div>
                            </section>
                          );
                        },
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : renderEmpty ? (
          <div className="changelogEmptyState">
            <h2>
              {t("changelog.empty.heading", {
                defaultValue: "No changelog entries yet.",
              })}
            </h2>
            <p>
              {t("changelog.empty.body", {
                defaultValue:
                  "The release feed is connected, but no published changelog entries were found yet.",
              })}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}