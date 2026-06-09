import {
  isValidElement,
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
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  fetchDocsBody,
  fetchDocsDoc,
  fetchDocsDocs,
  type DocsDoc,
  DocsDocNotFoundError,
} from "../../../api/marketing/docs";
import styles from "./DocsView.module.css";

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

/** Deterministic heading slug used to assign `id`s to rendered headings. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
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

const MD_COMPONENTS: Components = {
  a: ExternalLink,
  h1: HeadingWithId("h1"),
  h2: HeadingWithId("h2"),
  h3: HeadingWithId("h3"),
};

/** Title-case a section key for the nav group header (e.g. "aura-os-server"). */
function sectionLabel(key: string): string {
  if (!key) return "General";
  return key
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface NavGroup {
  readonly key: string;
  readonly label: string;
  readonly docs: readonly DocsDoc[];
}

/**
 * Group published pages by their `blogType` key into ordered nav groups.
 * Groups are ordered by the smallest `sortOrder` they contain; entries
 * within a group are ordered by `sortOrder` ascending.
 */
function buildNavGroups(docs: readonly DocsDoc[]): NavGroup[] {
  const byKey = new Map<string, DocsDoc[]>();
  for (const doc of docs) {
    const key = doc.blogType || "";
    const list = byKey.get(key) ?? [];
    list.push(doc);
    byKey.set(key, list);
  }
  const groups: NavGroup[] = [];
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

function DocsNav({
  groups,
  activeSlug,
}: {
  groups: readonly NavGroup[];
  activeSlug: string | null;
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
    <nav className={styles.nav} aria-label="Documentation navigation">
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
              {isCollapsed ? (
                <ChevronRight size={13} aria-hidden="true" />
              ) : (
                <ChevronDown size={13} aria-hidden="true" />
              )}
              <span>{group.label}</span>
            </button>
            {!isCollapsed ? (
              <ul className={styles.navList}>
                {group.docs.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      to={`/docs/${doc.slug}`}
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
function DocsToc({ items }: { items: readonly TocItem[] }): React.ReactElement | null {
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
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.tocTitle}>On this page</p>
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

/**
 * Public `/docs` documentation site. GitBook / Mintlify-style three-column
 * layout: a collapsible left-hand nav of published pages (grouped by
 * repository / section key), the markdown reading column in the centre,
 * and a right-hand "On this page" TOC. The active page is read from
 * `/docs/:slug` (defaulting to the first page). The markdown body is not
 * part of the page JSON, so it is fetched separately from the page's public
 * S3 `bodyUrl`. Page chrome is owned by the public-mode `PublicMarketingPanel`.
 */
export function DocsView(): React.ReactElement {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ["marketing-docs"],
    queryFn: fetchDocsDocs,
  });

  const allDocs = useMemo<readonly DocsDoc[]>(() => docs ?? [], [docs]);
  const groups = useMemo(() => buildNavGroups(allDocs), [allDocs]);

  // Resolve the active page: the slug param, else the first page.
  const activeSlug = slug ?? allDocs[0]?.slug ?? null;

  const { data: doc, error: docError } = useQuery({
    queryKey: ["marketing-docs-doc", activeSlug],
    queryFn: () => fetchDocsDoc(activeSlug as string),
    enabled: Boolean(activeSlug),
    retry: false,
  });

  const bodyUrl = doc?.bodyUrl;
  const { data: body, isLoading: bodyLoading } = useQuery({
    queryKey: ["marketing-docs-body", bodyUrl],
    queryFn: () => fetchDocsBody(bodyUrl as string),
    enabled: Boolean(bodyUrl),
  });

  const toc = useMemo(() => (body ? buildToc(body) : []), [body]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = doc ? `AURA Docs - ${doc.title}` : "AURA - Docs";
    return () => {
      document.title = previousTitle;
    };
  }, [doc]);

  // Scroll the reading column back to the top when the page changes.
  useEffect(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector("[data-docs-content]")
        ?.scrollTo?.({ top: 0, behavior: "auto" });
    });
  }, [activeSlug]);

  return (
    <section className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Link to="/docs" className={styles.sidebarTitle}>
            Documentation
          </Link>
          {docsLoading ? (
            <p className={styles.navState} aria-busy="true">
              Loading…
            </p>
          ) : groups.length === 0 ? (
            <p className={styles.navState}>No pages yet.</p>
          ) : (
            <DocsNav groups={groups} activeSlug={activeSlug} />
          )}
        </aside>

        <article className={styles.content} data-docs-content>
          {docError instanceof DocsDocNotFoundError ? (
            <div className={styles.notFound}>
              <h1>Page not found</h1>
              <p>
                This documentation page doesn&apos;t exist or isn&apos;t
                published yet.
              </p>
              <button
                type="button"
                className={styles.notFoundLink}
                onClick={() => navigate("/docs")}
              >
                Back to the overview
              </button>
            </div>
          ) : (
            <div className={styles.markdownBody}>
              {bodyLoading ? (
                <p className={styles.navState} aria-busy="true">
                  Loading…
                </p>
              ) : body ? (
                <ReactMarkdown
                  remarkPlugins={MD_REMARK}
                  rehypePlugins={MD_REHYPE}
                  components={MD_COMPONENTS}
                >
                  {body}
                </ReactMarkdown>
              ) : !docsLoading && allDocs.length === 0 ? (
                <p className={styles.navState}>
                  The documentation site is connected, but no pages have been
                  published yet.
                </p>
              ) : (
                <p className={styles.navState}>This page has no content yet.</p>
              )}
            </div>
          )}
        </article>

        <aside className={styles.tocColumn}>
          {!docError && body ? <DocsToc items={toc} /> : null}
        </aside>
      </div>
    </section>
  );
}
