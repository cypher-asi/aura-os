import { type ReactNode, useEffect } from "react";
import { PageHero } from "../PageHero";

/**
 * Marketing `/privacy` page. Placeholder scaffold that reuses the shared
 * centered `PageHero` chrome; the real Privacy Policy copy is to be
 * filled in later. Page-level chrome (titlebar / sidebar / scrollable
 * column) is owned by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function PrivacyView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Privacy Policy";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PageHero
      label="LEGAL"
      headline="Privacy Policy"
      description="Our Privacy Policy is being finalized and will be published here soon."
      preview={null}
      centered
    />
  );
}
