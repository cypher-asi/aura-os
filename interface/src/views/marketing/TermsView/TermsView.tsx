import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageHero } from "../PageHero";

/**
 * Marketing `/terms` page. Placeholder scaffold that reuses the shared
 * centered `PageHero` chrome; the real Terms of Service copy is to be
 * filled in later. Page-level chrome (titlebar / sidebar / scrollable
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
    <PageHero
      label={t("terms.label", { defaultValue: "LEGAL" })}
      headline={t("terms.headline", { defaultValue: "Terms of Service" })}
      description={t("terms.description", {
        defaultValue:
          "Our Terms of Service are being finalized and will be published here soon.",
      })}
      preview={null}
      centered
    />
  );
}
