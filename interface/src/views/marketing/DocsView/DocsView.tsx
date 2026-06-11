import { useTranslation } from "react-i18next";

import {
  fetchDocsBody,
  fetchDocsDoc,
  fetchDocsDocs,
  type DocsDoc,
  DocsDocNotFoundError,
} from "../../../api/marketing/docs";
import { MarkdownDocSite } from "../shared/MarkdownDocSite";

/** Title-case a section key for the nav group header (e.g. "aura-os-server"). */
function sectionLabel(key: string): string {
  if (!key) return "General";
  return key
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Public `/docs` documentation site. A thin wrapper over the shared
 * {@link MarkdownDocSite} with the right-hand "On this page" TOC enabled:
 * a collapsible left-hand nav of published pages (grouped by repository /
 * section key), the markdown reading column in the centre, and the TOC.
 */
export function DocsView(): React.ReactElement {
  const { t } = useTranslation("marketing");

  return (
    <MarkdownDocSite<DocsDoc>
      basePath="/docs"
      queryKeyPrefix="marketing-docs"
      fetchList={fetchDocsDocs}
      fetchDoc={fetchDocsDoc}
      fetchBody={fetchDocsBody}
      isNotFoundError={(err) => err instanceof DocsDocNotFoundError}
      sectionLabel={sectionLabel}
      showToc
      documentTitle={t("docs.documentTitle", { defaultValue: "AURA - Docs" })}
      getDocDocumentTitle={(title) =>
        t("docs.docDocumentTitle", {
          defaultValue: `AURA Docs - ${title}`,
          title,
        })
      }
      text={{
        sidebarTitle: t("docs.sidebarTitle", { defaultValue: "Documentation" }),
        navigationAriaLabel: t("docs.navigationAriaLabel", {
          defaultValue: "Documentation navigation",
        }),
        emptyNav: t("docs.noPages", { defaultValue: "No pages yet." }),
        emptyBody: t("docs.empty.body", {
          defaultValue:
            "The documentation site is connected, but no pages have been published yet.",
        }),
        noContent: t("docs.noContent", {
          defaultValue: "This page has no content yet.",
        }),
        notFoundHeading: t("docs.notFound.heading", {
          defaultValue: "Page not found",
        }),
        notFoundBody: t("docs.notFound.body", {
          defaultValue:
            "This documentation page doesn't exist or isn't published yet.",
        }),
        notFoundBack: t("docs.notFound.backButton", {
          defaultValue: "Back to the overview",
        }),
        tocAriaLabel: t("docs.tocAriaLabel", { defaultValue: "On this page" }),
        tocTitle: t("docs.tocTitle", { defaultValue: "On this page" }),
      }}
    />
  );
}
