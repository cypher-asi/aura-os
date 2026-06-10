import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageHero } from "../PageHero";

/**
 * Marketing `/privacy` page. Placeholder scaffold that reuses the shared
 * centered `PageHero` chrome; the real Privacy Policy copy is to be
 * filled in later. Page-level chrome (titlebar / sidebar / scrollable
 * column) is owned by the public-mode `AuraShell` + `PublicMarketingPanel`.
 */
export function PrivacyView(): ReactNode {
  const { t } = useTranslation("marketing");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t("privacy.documentTitle", {
      defaultValue: "AURA - Privacy Policy",
    });

    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  return (
    <PageHero
      label={t("privacy.label", { defaultValue: "LEGAL" })}
      headline={t("privacy.headline", { defaultValue: "Privacy Policy" })}
      description={t("privacy.description", {
        defaultValue:
          "Our Privacy Policy is being finalized and will be published here soon.",
      })}
      preview={null}
      centered
    />
  );
}
