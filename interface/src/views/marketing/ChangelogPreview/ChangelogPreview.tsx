import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  fetchChangelogEntries,
  type ChangelogEntry,
} from "../../../api/marketing/changelog";
import "./ChangelogPreview.css";

type ChangelogPreviewProps = {
  readonly heading?: string;
  readonly limit?: number;
  readonly ctaLabel?: string;
  readonly ctaHref?: string;
};

function formatCardDate(value: string, language: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function getCardTitle(entry: ChangelogEntry): string {
  if (entry.rendered.title && entry.rendered.title.trim().length > 0) {
    return entry.rendered.title;
  }
  const firstTimeline = entry.rendered.entries[0];
  return firstTimeline?.title ?? "";
}

/**
 * Ported from `aura-web/src/components/ChangelogPreview/ChangelogPreview.tsx`.
 * The source was an `async` React Server Component that awaited
 * `getChangelogEntries()` at request time; here we run as a client
 * component using React Query against the static GitHub Pages index
 * fetched via `api/marketing/changelog.ts`.
 *
 * Behavior parity:
 *   - While loading or on error, renders `null` (same as the source's
 *     "no entries -> render nothing" branch).
 *   - The `cta`, grid, and per-card markup are unchanged.
 */
export function ChangelogPreview({
  heading = "Changelog",
  limit = 4,
  ctaLabel = "See what's new in AURA",
  ctaHref = "/changelog",
}: ChangelogPreviewProps = {}): React.ReactNode {
  const { t, i18n } = useTranslation("marketing");
  const resolvedHeading =
    heading === "Changelog"
      ? t("changelogPreview.heading", { defaultValue: "Changelog" })
      : heading;
  const resolvedCtaLabel =
    ctaLabel === "See what's new in AURA"
      ? t("changelogPreview.ctaLabel", {
          defaultValue: "See what's new in AURA",
        })
      : ctaLabel;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketing-changelog"],
    queryFn: fetchChangelogEntries,
  });

  if (isLoading || isError || !data) {
    return null;
  }

  const visibleEntries = data.slice(0, limit);
  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <section
      className="changelogPreview"
      aria-label={t("changelogPreview.ariaLabel", {
        defaultValue: "Recent changelog entries",
      })}
    >
      <div className="changelogPreviewShell">
        <h2 className="changelogPreviewHeading">{resolvedHeading}</h2>
        <div className="changelogPreviewGrid">
          {visibleEntries.map((entry) => {
            const entryKey = `${entry.date}-${entry.version ?? entry.generatedAt}`;
            const title =
              getCardTitle(entry) ||
              t("changelogPreview.releaseUpdate", {
                defaultValue: "Release update",
              });
            return (
              <Link
                key={entryKey}
                to={ctaHref}
                className="changelogPreviewCard"
              >
                <time
                  className="changelogPreviewDate"
                  dateTime={entry.date}
                >
                  {formatCardDate(entry.date, i18n.language)}
                </time>
                <p className="changelogPreviewTitle">{title}</p>
                {entry.version ? (
                  <span className="changelogPreviewVersion">
                    {entry.version}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
        <Link to={ctaHref} className="changelogPreviewCta">
          {resolvedCtaLabel} <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </section>
  );
}
