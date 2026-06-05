import { type ReactNode, useEffect } from "react";
import { PageHero } from "../PageHero";

/**
 * Marketing `/terms` page. Placeholder scaffold that reuses the shared
 * centered `PageHero` chrome; the real Terms of Service copy is to be
 * filled in later. Page-level chrome (titlebar / sidebar / scrollable
 * column) is owned by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function TermsView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Terms of Service";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PageHero
      label="LEGAL"
      headline="Terms of Service"
      description="Our Terms of Service are being finalized and will be published here soon."
      preview={null}
      centered
    />
  );
}
