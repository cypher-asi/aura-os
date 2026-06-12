/**
 * Shared implementation of the public markdown "doc site" used by both the
 * `/os` AURA OS whitepaper and the `/docs` documentation site. Both are
 * CMS-backed marketing pages whose pages are notes stored under a reserved
 * project and served anonymously; they share an identical GitBook /
 * Mintlify-style layout (collapsible left-hand nav grouped by `blogType`, a
 * markdown reading column, and an optional right-hand "On this page" TOC).
 *
 * Each site is a thin wrapper (`OsView`, `DocsView`) that supplies its own
 * data fetchers, route base, copy, and any markdown component overrides
 * (e.g. the whitepaper's inline code-reference links). The markdown body is
 * not part of the page JSON, so it is fetched separately from the page's
 * public S3 `bodyUrl`. Page chrome is owned by `PublicMarketingPanel`.
 */
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight, Menu } from "lucide-react";

import styles from "./MarkdownDocSite.module.css";
import { extractText, slugify } from "./markdown";

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

/**
 * Public, camelCase projection of a published doc-site page (`StorageNote`).
 * The markdown body is intentionally absent (fetch it from `bodyUrl`). The
 * `blogType` field doubles as the nav group / section key.
 */
export interface MarketingDoc {
  readonly id: string;
  readonly projectId: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly slug: string;
  readonly sortOrder: number;
  readonly wordCount: number;
  readonly bodyUrl: string;
  readonly bodyS3Key: string;
  readonly status: string;
  readonly blogType: string;
  readonly excerpt: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function ExternalLink(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>,
): React.ReactElement {
  const href = props.href ?? "";
  // In-page anchors stay in-document; everything else opens in a new tab.
  if (href.startsWith("#")) return <a {...props} />;
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function HeadingWithId(
  Tag: "h1" | "h2" | "h3",
): (props: { children?: ReactNode }) => React.ReactElement {
  return function Heading({ children }): React.ReactElement {
    return <Tag id={slugify(extractText(children))}>{children}</Tag>;
  };
}

/** Shared base markdown component overrides (links + id'd headings). */
const BASE_MD_COMPONENTS: Components = {
  a: ExternalLink,
  h1: HeadingWithId("h1"),
  h2: HeadingWithId("h2"),
  h3: HeadingWithId("h3"),
};

interface NavGroup<D extends MarketingDoc> {
  readonly key: string;
  readonly label: string;
  readonly docs: readonly D[];
}

/**
 * Group published pages by their `blogType` key into ordered nav groups.
 * Groups are ordered by the smallest `sortOrder` they contain; entries
 * within a group are ordered by `sortOrder` ascending.
 */
function buildNavGroups<D extends MarketingDoc>(
  docs: readonly D[],
  sectionLabel: (key: string) => string,
): NavGroup<D>[] {
  const byKey = new Map<string, D[]>();
  for (const doc of docs) {
    const key = doc.blogType || "";
    const list = byKey.get(key) ?? [];
    list.push(doc);
    byKey.set(key, list);
  }
  const groups: NavGroup<D>[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    groups.push({ key, label: sectionLabel(key), docs: sorted });
  }
  groups.sort((a, b) => a.docs[0].sortOrder - b.docs[0].sortOrder);
  return groups;
}

interface TocItem {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

/**
 * Parse `##` / `###` headings out of a markdown body into a flat list of
 * TOC entries, skipping fenced code blocks so `#` comments inside code
 * never become headings. Ids match {@link slugify} so the in-page anchor
 * links resolve to the rendered heading ids.
 */
function buildToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const level = match[1].length === 2 ? 2 : 3;
    const text = match[2].trim();
    items.push({ id: slugify(text), text, level });
  }
  return items;
}

function DocNav<D extends MarketingDoc>({
  groups,
  activeSlug,
  basePath,
  navigationAriaLabel,
}: {
  groups: readonly NavGroup<D>[];
  activeSlug: string | null;
  basePath: string;
  navigationAriaLabel: string;
}): React.ReactElement {
  // All groups expanded by default; clicking a header collapses it.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <nav className={styles.nav} aria-label={navigationAriaLabel}>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        return (
          <div key={group.key} className={styles.navGroup}>
            <button
              type="button"
              className={styles.navGroupHeader}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(group.key)}
            >
              <span>{group.label}</span>
              {isCollapsed ? (
                <ChevronRight size={13} aria-hidden="true" />
              ) : (
                <ChevronDown size={13} aria-hidden="true" />
              )}
            </button>
            {!isCollapsed ? (
              <ul className={styles.navList}>
                {group.docs.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      to={`${basePath}/${doc.slug}`}
                      className={`${styles.navLink} ${
                        doc.slug === activeSlug ? styles.navLinkActive : ""
                      }`}
                    >
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Right-hand "On this page" table of contents. Tracks the active heading
 * with an `IntersectionObserver` over the rendered heading ids so the
 * current section is highlighted as the reader scrolls.
 */
function DocToc({
  items,
  ariaLabel,
  title,
}: {
  items: readonly TocItem[];
  ariaLabel: string;
  title: string;
}): React.ReactElement | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (items.length === 0) return;
    const headings = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el != null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const h of headings) observer.observe(h);
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav className={styles.toc} aria-label={ariaLabel}>
      <p className={styles.tocTitle}>{title}</p>
      <ul className={styles.tocList}>
        {items.map((item) => (
          <li
            key={item.id}
            className={item.level === 3 ? styles.tocItemSub : undefined}
          >
            <a
              href={`#${item.id}`}
              className={`${styles.tocLink} ${
                item.id === activeId ? styles.tocLinkActive : ""
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Resolved copy for a doc site, supplied (and localized) by each wrapper. */
export interface MarkdownDocSiteText {
  readonly sidebarTitle: string;
  readonly navigationAriaLabel: string;
  /** Sidebar state when no groups exist (e.g. "No pages yet."). */
  readonly emptyNav: string;
  /** Reading-column body when the site is connected but empty. */
  readonly emptyBody: string;
  /** Reading-column body when a page exists but has no markdown. */
  readonly noContent: string;
  /** Optional "Loading…" copy; when omitted, loading states render nothing. */
  readonly loading?: string;
  readonly notFoundHeading: string;
  readonly notFoundBody: string;
  readonly notFoundBack: string;
  readonly tocAriaLabel?: string;
  readonly tocTitle?: string;
}

export interface MarkdownDocSiteProps<D extends MarketingDoc> {
  /** Route base for nav links and the sidebar title link (e.g. "/docs"). */
  readonly basePath: string;
  /** React Query key prefix (e.g. "marketing-docs"). */
  readonly queryKeyPrefix: string;
  readonly fetchList: () => Promise<D[]>;
  readonly fetchDoc: (slug: string) => Promise<D>;
  readonly fetchBody: (bodyUrl: string) => Promise<string>;
  /** Narrow a query error to the wrapper's "not found" error type. */
  readonly isNotFoundError: (err: unknown) => boolean;
  /** Resolve a `blogType` key to its nav group header label. */
  readonly sectionLabel: (key: string) => string;
  /** Extra react-markdown component overrides merged over the shared base. */
  readonly markdownComponents?: Components;
  /**
   * Optionally wrap the rendered markdown for the active doc (e.g. to
   * provide a context the markdown components read from).
   */
  readonly wrapMarkdown?: (node: ReactElement, activeDoc: D) => ReactElement;
  /** Render the right-hand "On this page" TOC column when true. */
  readonly showToc?: boolean;
  readonly text: MarkdownDocSiteText;
  /** `document.title` when no specific page is active. */
  readonly documentTitle: string;
  /** `document.title` for the active page, given its title. */
  readonly getDocDocumentTitle: (docTitle: string) => string;
}

export function MarkdownDocSite<D extends MarketingDoc>({
  basePath,
  queryKeyPrefix,
  fetchList,
  fetchDoc,
  fetchBody,
  isNotFoundError,
  sectionLabel,
  markdownComponents,
  wrapMarkdown,
  showToc = false,
  text,
  documentTitle,
  getDocDocumentTitle,
}: MarkdownDocSiteProps<D>): React.ReactElement {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();

  // Mobile-only: the left nav collapses behind a toggle so the reading
  // column isn't buried under the full page tree. Closed by default on a
  // phone; the toggle is hidden entirely on desktop (CSS).
  const [navOpen, setNavOpen] = useState(false);

  const { data: docs, isFetched: docsFetched } = useQuery({
    queryKey: [`${queryKeyPrefix}`],
    queryFn: fetchList,
  });

  const allDocs = useMemo<readonly D[]>(() => docs ?? [], [docs]);
  const groups = useMemo(
    () => buildNavGroups(allDocs, sectionLabel),
    [allDocs, sectionLabel],
  );

  // Resolve the active page: the slug param, else the first page.
  const activeSlug = slug ?? allDocs[0]?.slug ?? null;

  // Close the mobile nav whenever the active page changes (i.e. the
  // visitor tapped a nav link) so the reading column comes into view.
  useEffect(() => {
    setNavOpen(false);
  }, [activeSlug]);

  const { data: doc, error: docError } = useQuery({
    queryKey: [`${queryKeyPrefix}-doc`, activeSlug],
    queryFn: () => fetchDoc(activeSlug as string),
    enabled: Boolean(activeSlug),
    retry: false,
  });

  const bodyUrl = doc?.bodyUrl;
  const { data: body, isFetched: bodyFetched } = useQuery({
    queryKey: [`${queryKeyPrefix}-body`, bodyUrl],
    queryFn: () => fetchBody(bodyUrl as string),
    enabled: Boolean(bodyUrl),
  });

  const mdComponents = useMemo<Components>(
    () => ({ ...BASE_MD_COMPONENTS, ...markdownComponents }),
    [markdownComponents],
  );

  const toc = useMemo(
    () => (showToc && body ? buildToc(body) : []),
    [showToc, body],
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = doc ? getDocDocumentTitle(doc.title) : documentTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [doc, documentTitle, getDocDocumentTitle]);

  // Scroll the reading column back to the top when the page changes.
  useEffect(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector("[data-doc-content]")
        ?.scrollTo?.({ top: 0, behavior: "auto" });
    });
  }, [activeSlug]);

  const notFound = isNotFoundError(docError);

  const renderedBody = body ? (
    <ReactMarkdown
      remarkPlugins={MD_REMARK}
      rehypePlugins={MD_REHYPE}
      components={mdComponents}
    >
      {body}
    </ReactMarkdown>
  ) : null;

  const wrappedBody =
    renderedBody && wrapMarkdown && doc
      ? wrapMarkdown(renderedBody, doc)
      : renderedBody;

  return (
    <section className={styles.page}>
      <div
        className={`${styles.layout} ${showToc ? styles.layoutWithToc : ""}`}
      >
        <button
          type="button"
          className={styles.navToggle}
          aria-expanded={navOpen}
          aria-controls="doc-mobile-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          <Menu size={16} strokeWidth={2} aria-hidden="true" />
          <span className={styles.navToggleLabel}>{text.sidebarTitle}</span>
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className={`${styles.navToggleChevron} ${
              navOpen ? styles.navToggleChevronOpen : ""
            }`}
          />
        </button>
        <aside
          id="doc-mobile-nav"
          className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ""}`}
        >
          <Link to={basePath} className={styles.sidebarTitle}>
            {text.sidebarTitle}
          </Link>
          {!docsFetched ? (
            text.loading ? (
              <p className={styles.navState} aria-busy="true">
                {text.loading}
              </p>
            ) : null
          ) : groups.length === 0 ? (
            <p className={styles.navState}>{text.emptyNav}</p>
          ) : (
            <DocNav
              groups={groups}
              activeSlug={activeSlug}
              basePath={basePath}
              navigationAriaLabel={text.navigationAriaLabel}
            />
          )}
        </aside>

        <article className={styles.content} data-doc-content>
          {notFound ? (
            <div className={styles.notFound}>
              <h1>{text.notFoundHeading}</h1>
              <p>{text.notFoundBody}</p>
              <button
                type="button"
                className={styles.notFoundLink}
                onClick={() => navigate(basePath)}
              >
                {text.notFoundBack}
              </button>
            </div>
          ) : (
            <div className={styles.markdownBody}>
              {wrappedBody ? (
                wrappedBody
              ) : !docsFetched ? (
                text.loading ? (
                  <p className={styles.navState} aria-busy="true">
                    {text.loading}
                  </p>
                ) : null
              ) : allDocs.length === 0 ? (
                <p className={styles.navState}>{text.emptyBody}</p>
              ) : !bodyFetched ? (
                text.loading ? (
                  <p className={styles.navState} aria-busy="true">
                    {text.loading}
                  </p>
                ) : null
              ) : (
                <p className={styles.navState}>{text.noContent}</p>
              )}
            </div>
          )}
        </article>

        {showToc ? (
          <aside className={styles.tocColumn}>
            {!notFound && body ? (
              <DocToc
                items={toc}
                ariaLabel={text.tocAriaLabel ?? ""}
                title={text.tocTitle ?? ""}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
