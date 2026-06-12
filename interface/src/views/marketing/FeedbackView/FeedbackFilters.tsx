import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Clock,
  Eye,
  Filter,
  Flame,
  Globe,
  HelpCircle,
  Layers,
  MessageCircle,
  Palette,
  Rocket,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type {
  FeedbackCategory,
  FeedbackStatus,
} from "../../../api/marketing/feedback";
import {
  CATEGORY_LABELS,
  FEEDBACK_ALL_CATEGORY_OPTION,
  FEEDBACK_ALL_STATUS_OPTION,
  FEEDBACK_CATEGORY_FILTERS,
  FEEDBACK_SORT_FILTERS,
  FEEDBACK_STATUS_FILTERS,
  STATUS_LABELS,
  type FeedbackFilterOption,
} from "./feedback-constants";

const ICONS: Record<string, LucideIcon> = {
  Clock,
  Star,
  Flame,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Bug,
  Palette,
  MessageCircle,
  HelpCircle,
  CircleDashed,
  Eye,
  CircleDot,
  CheckCircle2,
  Rocket,
  Layers,
  Globe,
};

interface IconProps {
  readonly name: string;
}

function Icon({ name }: IconProps): ReactNode {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={14} strokeWidth={1.75} />;
}

type SectionId = "trending" | "type" | "status";

interface FolderSectionProps {
  readonly label: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

function FolderSection({
  label,
  expanded,
  onToggle,
  children,
}: FolderSectionProps): ReactNode {
  return (
    <div className="feedbackFolder">
      <button
        type="button"
        className="feedbackFolderHeader"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="feedbackFolderLabel">{label}</span>
        <span
          className={`feedbackFolderChevron ${expanded ? "feedbackFolderChevronOpen" : ""}`}
          aria-hidden
        >
          <ChevronRight size={12} strokeWidth={2} />
        </span>
      </button>
      {expanded && <div className="feedbackFolderBody">{children}</div>}
    </div>
  );
}

interface FilterRowProps<Id extends string> {
  readonly option: FeedbackFilterOption<Id>;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: (id: Id) => void;
}

function FilterRow<Id extends string>({
  option,
  label,
  selected,
  onSelect,
}: FilterRowProps<Id>): ReactNode {
  return (
    <button
      type="button"
      className={`feedbackFilterRow ${selected ? "feedbackFilterRowActive" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(option.id)}
    >
      <span className="feedbackFilterRowIcon" aria-hidden>
        <Icon name={option.iconName} />
      </span>
      <span className="feedbackFilterRowLabel">{label}</span>
    </button>
  );
}

export interface FeedbackFiltersProps {
  readonly sort: string;
  readonly category: string | null;
  readonly status: string | null;
}

export function FeedbackFilters({
  sort,
  category,
  status,
}: FeedbackFiltersProps): ReactNode {
  const { t } = useTranslation("marketing");
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    trending: true,
    type: true,
    status: true,
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const sortLabel = useCallback(
    (option: FeedbackFilterOption<string>) =>
      t(`feedback.filters.sort.${option.id}`, { defaultValue: option.label }),
    [t],
  );
  const categoryLabel = useCallback(
    (option: FeedbackFilterOption<string>) =>
      t(`feedback.filters.category.${option.id}`, {
        defaultValue: option.label,
      }),
    [t],
  );
  const statusLabel = useCallback(
    (option: FeedbackFilterOption<string>) =>
      t(`feedback.filters.status.${option.id}`, { defaultValue: option.label }),
    [t],
  );

  const toggle = useCallback((id: SectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const updateParam = useCallback(
    (key: "sort" | "type" | "status", value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const query = next.toString();
      navigate(
        {
          pathname: location.pathname,
          search: query ? `?${query}` : "",
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [location.pathname, navigate, searchParams],
  );

  const summary = useMemo(() => {
    const parts: string[] = [];
    const sortOption = FEEDBACK_SORT_FILTERS.find((s) => s.id === sort);
    if (sortOption) parts.push(sortLabel(sortOption));
    if (category) {
      const fallback = CATEGORY_LABELS[category as FeedbackCategory] ?? category;
      parts.push(
        t(`feedback.filters.category.${category}`, { defaultValue: fallback }),
      );
    }
    if (status) {
      const fallback = STATUS_LABELS[status as FeedbackStatus] ?? status;
      parts.push(t(`feedback.filters.status.${status}`, { defaultValue: fallback }));
    }
    return parts.join(" \u00b7 ");
  }, [sort, category, status, sortLabel, t]);

  return (
    <aside
      className={`feedbackSidebar ${mobileOpen ? "feedbackSidebarOpen" : ""}`}
      aria-label={t("feedback.filters.ariaLabel", {
        defaultValue: "Feedback filters",
      })}
    >
      <button
        type="button"
        className="feedbackMobileToggle"
        aria-expanded={mobileOpen}
        aria-controls="feedback-filters-body"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <Filter size={14} strokeWidth={1.75} />
        <span className="feedbackMobileToggleLabel">
          {t("feedback.filters.toggle", { defaultValue: "Filters" })}
        </span>
        {summary ? (
          <span className="feedbackMobileToggleSummary">{summary}</span>
        ) : null}
        <span
          className={`feedbackMobileToggleChevron ${mobileOpen ? "feedbackMobileToggleChevronOpen" : ""}`}
          aria-hidden
        >
          <ChevronDown size={14} strokeWidth={1.75} />
        </span>
      </button>

      <div id="feedback-filters-body" className="feedbackSidebarBody">
        <FolderSection
          label={t("feedback.filters.sections.trending", {
            defaultValue: "Trending",
          })}
          expanded={expanded.trending}
          onToggle={() => toggle("trending")}
        >
          {FEEDBACK_SORT_FILTERS.map((opt) => (
            <FilterRow
              key={opt.id}
              option={opt}
              label={sortLabel(opt)}
              selected={opt.id === sort}
              onSelect={(id) => updateParam("sort", id)}
            />
          ))}
        </FolderSection>

        <FolderSection
          label={t("feedback.filters.sections.type", { defaultValue: "Type" })}
          expanded={expanded.type}
          onToggle={() => toggle("type")}
        >
          <FilterRow
            option={FEEDBACK_ALL_CATEGORY_OPTION}
            label={categoryLabel(FEEDBACK_ALL_CATEGORY_OPTION)}
            selected={category === null}
            onSelect={() => updateParam("type", null)}
          />
          {FEEDBACK_CATEGORY_FILTERS.map((opt) => (
            <FilterRow
              key={opt.id}
              option={opt}
              label={categoryLabel(opt)}
              selected={opt.id === category}
              onSelect={(id) => updateParam("type", id)}
            />
          ))}
        </FolderSection>

        <FolderSection
          label={t("feedback.filters.sections.status", {
            defaultValue: "Status",
          })}
          expanded={expanded.status}
          onToggle={() => toggle("status")}
        >
          <FilterRow
            option={FEEDBACK_ALL_STATUS_OPTION}
            label={statusLabel(FEEDBACK_ALL_STATUS_OPTION)}
            selected={status === null}
            onSelect={() => updateParam("status", null)}
          />
          {FEEDBACK_STATUS_FILTERS.map((opt) => (
            <FilterRow
              key={opt.id}
              option={opt}
              label={statusLabel(opt)}
              selected={opt.id === status}
              onSelect={(id) => updateParam("status", id)}
            />
          ))}
        </FolderSection>
      </div>
    </aside>
  );
}