import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { type Components } from "react-markdown";

import {
  fetchOsBody,
  fetchOsDoc,
  fetchOsDocs,
  type OsDoc,
  OsDocNotFoundError,
} from "../../../api/marketing/os";
import { MarkdownDocSite } from "../shared/MarkdownDocSite";
import { extractText } from "../shared/markdown";
import styles from "../shared/MarkdownDocSite.module.css";

/**
 * GitHub repo (org/name) each section group's code references resolve to,
 * keyed by the section `blogType`. Defaults to the harness for unknown keys.
 */
const SECTION_REPOS: Readonly<Record<string, string>> = {
  harness: "cypher-asi/aura-harness",
  "aura-os": "cypher-asi/aura-os",
  "aura-router": "cypher-asi/aura-router",
  "aura-network": "cypher-asi/aura-network",
  "aura-storage": "cypher-asi/aura-storage",
  "z-billing": "cypher-asi/z-billing",
};

const DEFAULT_REPO = "cypher-asi/aura-harness";

/**
 * Repo that the inline code references in the currently-rendered section point
 * at. Set by `OsView` from the active doc's `blogType`; read by `CodeRef`.
 */
const OsRepoContext = createContext<string>(DEFAULT_REPO);

/**
 * Resolve an inline code token to a GitHub URL in the given repo. Crate names
 * (`aura-*`) map to their crate directory (resolves anonymously); everything
 * else (files, functions, types) falls back to a repo-scoped code search.
 */
function codeHref(token: string, repo: string): string {
  const t = token.trim();
  if (/^aura-[a-z0-9-]+$/.test(t)) {
    return `https://github.com/${repo}/tree/main/crates/${t}`;
  }
  return `https://github.com/search?q=${encodeURIComponent(
    `repo:${repo} ${t}`,
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
  const repo = useContext(OsRepoContext);
  const text = extractText(children);
  const isBlock = /\blanguage-/.test(className ?? "") || text.includes("\n");
  if (isBlock) {
    return <code className={className}>{children}</code>;
  }
  return (
    <a
      href={codeHref(text, repo)}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.codeLink}
    >
      <code className={className}>{children}</code>
    </a>
  );
}

const MD_COMPONENTS: Components = { code: CodeRef };

/** Display-name overrides for section keys (e.g. "harness" -> "AURA Harness"). */
const SECTION_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  harness: "AURA Harness",
  "aura-os": "AURA OS",
  "aura-router": "AURA Router",
  "aura-network": "AURA Network",
  "aura-storage": "AURA Storage",
  "z-billing": "Z-Billing",
};

/** Resolve the nav group header for a section key (e.g. "harness"). */
function sectionLabel(key: string): string {
  if (!key) return "General";
  return (
    // Case-insensitive so a stored `blogType` of "harness"/"Harness" both map.
    SECTION_DISPLAY_LABELS[key.toLowerCase()] ??
    key
      .split(/[-_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function wrapMarkdown(node: ReactElement, doc: OsDoc): ReactElement {
  return (
    <OsRepoContext.Provider value={SECTION_REPOS[doc.blogType] ?? DEFAULT_REPO}>
      {node}
    </OsRepoContext.Provider>
  );
}

/**
 * Public `/os` AURA OS whitepaper. A thin wrapper over the shared
 * {@link MarkdownDocSite}: collapsible left-hand nav of published sections
 * (grouped by section key) beside a markdown reading column, with inline
 * code references linking out to the relevant GitHub repo.
 */
export function OsView(): React.ReactElement {
  const { t } = useTranslation("marketing");

  return (
    <MarkdownDocSite<OsDoc>
      basePath="/os"
      queryKeyPrefix="marketing-os"
      fetchList={fetchOsDocs}
      fetchDoc={fetchOsDoc}
      fetchBody={fetchOsBody}
      isNotFoundError={(err) => err instanceof OsDocNotFoundError}
      sectionLabel={sectionLabel}
      markdownComponents={MD_COMPONENTS}
      wrapMarkdown={wrapMarkdown}
      showToc
      documentTitle={t("os.documentTitle", { defaultValue: "AURA - OS" })}
      getDocDocumentTitle={(title) =>
        t("os.docDocumentTitle", {
          defaultValue: `AURA OS - ${title}`,
          title,
        })
      }
      text={{
        sidebarTitle: t("os.sidebarTitle", { defaultValue: "AURA OS" }),
        navigationAriaLabel: t("os.navigationAriaLabel", {
          defaultValue: "Whitepaper navigation",
        }),
        emptyNav: t("os.noSections", { defaultValue: "No sections yet." }),
        emptyBody: t("os.empty.body", {
          defaultValue:
            "The AURA OS whitepaper is connected, but no sections have been published yet.",
        }),
        noContent: t("os.noContent", {
          defaultValue: "This section has no content yet.",
        }),
        notFoundHeading: t("os.notFound.heading", {
          defaultValue: "Section not found",
        }),
        notFoundBody: t("os.notFound.body", {
          defaultValue:
            "This part of the whitepaper doesn't exist or isn't published yet.",
        }),
        notFoundBack: t("os.notFound.backButton", {
          defaultValue: "Back to the overview",
        }),
        tocAriaLabel: t("os.tocAriaLabel", { defaultValue: "On this page" }),
        tocTitle: t("os.tocTitle", { defaultValue: "On this page" }),
      }}
    />
  );
}
