import { type ReactNode, useEffect } from "react";
import { PageHero } from "../PageHero";

/**
 * Marketing `/docs` page. Placeholder scaffold that reuses the shared
 * centered `PageHero` chrome; the real documentation content is to be
 * filled in later. Page-level chrome (titlebar / sidebar / scrollable
 * column) is owned by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function DocsView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Docs";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PageHero
      label="DOCUMENTATION"
      headline="Docs are on the way."
      description="Guides, references, and API documentation for AURA are coming soon."
      preview={null}
      centered
    />
  );
}
