import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LegalDocument } from "../LegalDocument";

const LEGAL_ENTITY = "CYPHER, INC.";
const GOVERNING_STATE = "Nevada";
const CONTACT_EMAIL = "support@aura.ai";

/**
 * Marketing `/terms` page. Renders the standard public marketing page
 * stack (hero, legal document body, changelog, CTA, footer) via the
 * shared `LegalDocument`. The document body lives in the `marketing`
 * i18n namespace (`terms.*`), so the page is language-aware across every
 * supported locale. Page-level chrome (titlebar / sidebar / scrollable
 * column) is owned by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function TermsView(): ReactNode {
  const { t } = useTranslation("marketing");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t("terms.documentTitle", {
      defaultValue: "AURA - Terms of Service",
    });

    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  return (
    <LegalDocument
      prefix="terms"
      company={LEGAL_ENTITY}
      state={GOVERNING_STATE}
      email={CONTACT_EMAIL}
    />
  );
}
