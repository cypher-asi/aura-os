import {
  isValidElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  fetchOsBody,
  fetchOsDoc,
  fetchOsDocs,
  type OsDoc,
  OsDocNotFoundError,
} from "../../../api/marketing/os";
import styles from "./OsView.module.css";

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

/** Public harness repo that the whitepaper's code references resolve to. */
const HARNESS_REPO = "cypher-asi/aura-harness";

/**
 * Resolve an inline code token to a GitHub URL in the harness repo. Crate
 * names (`aura-*`) map to their crate directory (resolves anonymously);
 * everything else (files, functions, types) falls back to a repo-scoped
 * code search.
 */
function codeHref(token: string): string {
  const t = token.trim();
  if (/^aura-[a-z0-9-]+$/.test(t)) {
    return `https://github.com/${HARNESS_REPO}/tree/main/crates/${t}`;
  }
  return `https://github.com/search?q=${encodeURIComponent(
    `repo:${HARNESS_REPO} ${t}`,
  )}&type=code`;
}

/**
 * Inline-code renderer: turns each `code` span into an external link to the
 * harness repo (new tab). Fenced/indented code blocks — which react-markdown
 * wraps in `<pre>` and which carry a `language-*` class or span multiple
 * lines — render unchanged so the `rehype-highlight` diagram styling is
 * preserved.
 */
function CodeRef({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): React.ReactElement {
  const text = extractText(children);
  const isBlock = /\blanguage-/.test(className ?? "") || text.includes("\n");
  if (isBlock) {
    return <code className={className}>{children}</code>;
  }
  return (
    <a
      href={codeHref(text)}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.codeLink}
    >
      <code className={className}>{children}</code>
    </a>
  );
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
  code: CodeRef,
  h1: HeadingWithId("h1"),
  h2: HeadingWithId("h2"),
  h3: HeadingWithId("h3"),
};

/** Display-name overrides for section keys (e.g. "harness"). */
const SECTION_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  harness: "AURA Harness",
};

/** Resolve the nav group header for a section key (e.g. "harness"). */
function sectionLabel(key: string): string {
  if (!key) return "General";
  return (
    SECTION_DISPLAY_LABELS[key] ??
    key
      .split(/[-_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

interface NavGroup {
  readonly key: string;
  readonly label: string;
  readonly docs: readonly OsDoc[];
}

/**
 * Group published sections by their `blogType` key into ordered nav
 * groups. Groups are ordered by the smallest `sortOrder` they contain;
 * entries within a group are ordered by `sortOrder` ascending.
 */
function buildNavGroups(docs: readonly OsDoc[]): NavGroup[] {
  const byKey = new Map<string, OsDoc[]>();
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

function OsNav({
  groups,
  activeSlug,
}: {
  groups: readonly NavGroup[];
  activeSlug: string | null;
}): React.ReactElement {
  const { t } = useTranslation("marketing");
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
    <nav
      className={styles.nav}
      aria-label={t("os.navigationAriaLabel", {
        defaultValue: "Whitepaper navigation",
      })}
    >
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
                      to={`/os/${doc.slug}`}
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
 * Public `/os` AURA OS whitepaper. Renders a collapsible left-hand nav of
 * the published sections (grouped by section key) beside a markdown
 * reading column. The active section is read from `/os/:slug` (defaulting
 * to the first section). The markdown body is not part of the section
 * JSON, so it is fetched separately from the section's public S3
 * `bodyUrl`. Page chrome is owned by the public-mode `PublicMarketingPanel`.
 */
export function OsView(): React.ReactElement {
  const { t } = useTranslation("marketing");
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ["marketing-os"],
    queryFn: fetchOsDocs,
  });

  const allDocs = useMemo<readonly OsDoc[]>(() => docs ?? [], [docs]);
  const groups = useMemo(() => buildNavGroups(allDocs), [allDocs]);

  // Resolve the active section: the slug param, else the first section.
  const activeSlug = slug ?? allDocs[0]?.slug ?? null;

  const {
    data: doc,
    error: docError,
    isLoading: docLoading,
  } = useQuery({
    queryKey: ["marketing-os-doc", activeSlug],
    queryFn: () => fetchOsDoc(activeSlug as string),
    enabled: Boolean(activeSlug),
    retry: false,
  });

  const bodyUrl = doc?.bodyUrl;
  const { data: body, isLoading: bodyLoading } = useQuery({
    queryKey: ["marketing-os-body", bodyUrl],
    queryFn: () => fetchOsBody(bodyUrl as string),
    enabled: Boolean(bodyUrl),
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = doc
      ? t("os.docDocumentTitle", {
          defaultValue: `AURA OS - ${doc.title}`,
          title: doc.title,
        })
      : t("os.documentTitle", { defaultValue: "AURA - OS" });
    return () => {
      document.title = previousTitle;
    };
  }, [doc, t]);

  // Scroll the reading column back to the top when the section changes.
  useEffect(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector("[data-os-content]")
        ?.scrollTo?.({ top: 0, behavior: "auto" });
    });
  }, [activeSlug]);

  return (
    <section className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Link to="/os" className={styles.sidebarTitle}>
            {t("os.sidebarTitle", { defaultValue: "AURA OS" })}
          </Link>
          {docsLoading ? null : groups.length === 0 ? (
            <p className={styles.navState}>
              {t("os.noSections", { defaultValue: "No sections yet." })}
            </p>
          ) : (
            <OsNav groups={groups} activeSlug={activeSlug} />
          )}
        </aside>

        <article className={styles.content} data-os-content>
          {docError instanceof OsDocNotFoundError ? (
            <div className={styles.notFound}>
              <h1>
                {t("os.notFound.heading", {
                  defaultValue: "Section not found",
                })}
              </h1>
              <p>
                {t("os.notFound.body", {
                  defaultValue:
                    "This part of the whitepaper doesn't exist or isn't published yet.",
                })}
              </p>
              <button
                type="button"
                className={styles.notFoundLink}
                onClick={() => navigate("/os")}
              >
                {t("os.notFound.backButton", {
                  defaultValue: "Back to the overview",
                })}
              </button>
            </div>
          ) : (
            <div className={styles.markdownBody}>
              {bodyLoading || docLoading ? null : body ? (
                  <ReactMarkdown
                    remarkPlugins={MD_REMARK}
                    rehypePlugins={MD_REHYPE}
                    components={MD_COMPONENTS}
                  >
                    {body}
                  </ReactMarkdown>
                ) : !docsLoading && allDocs.length === 0 ? (
                  <p className={styles.navState}>
                    {t("os.empty.body", {
                      defaultValue:
                        "The AURA OS whitepaper is connected, but no sections have been published yet.",
                    })}
                  </p>
                ) : (
                  <p className={styles.navState}>
                    {t("os.noContent", {
                      defaultValue: "This section has no content yet.",
                    })}
                  </p>
                )}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
