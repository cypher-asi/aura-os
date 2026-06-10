import { type ReactNode, useEffect } from "react";
import { AgentsPageSections } from "./AgentsPageSections";

/**
 * Marketing `/agents` page (formerly `/product`). The actual section
 * stack — hero, mobile-chat section, the "Private by Design" panel,
 * Changelog + Download footer — lives in `AgentsPageSections` so the
 * landing page (`/`) can embed the identical content below its persona
 * carousel. This route shell only owns the `document.title` swap.
 * Page-level chrome (titlebar / sidebar / scrollable column) is owned
 * by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function ProductView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Agents";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return <AgentsPageSections />;
}
