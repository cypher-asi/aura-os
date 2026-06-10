import { type ReactNode, useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CardSection, MetalCard } from "../CardSection";
import { ChangelogPreview } from "../ChangelogPreview";
import { MarketingFirstScreen } from "../MarketingFirstScreen";
import { MarketingFooter } from "../MarketingFooter";
import { PageHero } from "../PageHero";
import { PrivacyFeaturePanel } from "../PrivacyFeaturePanel";
import { ProductCallToAction } from "../ProductCallToAction";
import { Section } from "../Section";
import { TextCard } from "../TextCard";
import { getExpertiseEntry } from "./expertiseData";
import styles from "./ExpertiseDetailView.module.css";

/**
 * Marketing `/expertise/:slug` detail page. One data-driven template
 * shared by every Capability and Industry section (see
 * `expertiseData.ts`). It reuses the Agents page's section language:
 *
 *   1. Hero  — centered `PageHero` + a wide `MetalCard` "screen" whose
 *      media well is a placeholder for an image/video added later.
 *   2. Overview — shared `Section` + `TextCard`.
 *   3. Use cases — `CardSection` of `MetalCard` bento cells.
 *   4. Shared footer stack — `FeaturePanel` (privacy) + `ChangelogPreview`
 *      + `ProductCallToAction` + `MarketingFooter`, identical to
 *      `ProductView`.
 *
 * Page chrome (titlebar / sidebar / scroll column) is owned by the
 * public-mode `AuraShell` + `PublicMarketingPanel`, so this component
 * only renders the section stack. Unknown slugs redirect to `/agents`.
 */
export function ExpertiseDetailView(): ReactNode {
  const { t } = useTranslation("marketing");
  const { slug } = useParams<{ slug: string }>();
  const entry = slug ? getExpertiseEntry(slug) : undefined;

  useEffect(() => {
    if (!entry) return;
    const previousTitle = document.title;
    document.title = t("expertise.documentTitle", {
      defaultValue: `AURA - ${entry.label}`,
      label: t(`expertise.entries.${entry.slug}.label`, {
        defaultValue: entry.label,
      }),
    });
    return () => {
      document.title = previousTitle;
    };
  }, [entry, t]);

  if (!entry) {
    return <Navigate to="/agents" replace />;
  }

  const entryLabel = t(`expertise.entries.${entry.slug}.label`, {
    defaultValue: entry.label,
  });
  const entryHeadline = t(`expertise.entries.${entry.slug}.headline`, {
    defaultValue: entry.headline,
  });
  const entryHeroBlurb = t(`expertise.entries.${entry.slug}.heroBlurb`, {
    defaultValue: entry.heroBlurb,
  });
  const entryOverview = t(`expertise.entries.${entry.slug}.overview`, {
    defaultValue: entry.overview,
  });

  return (
    <div className={styles.expertiseView}>
      <MarketingFirstScreen
        hero={
          <PageHero
            label={entryLabel}
            headline={entryHeadline}
            description={entryHeroBlurb}
            preview={null}
            centered
            headlineCta={
              <button type="button" className={styles.demoButton}>
                {t("expertise.requestDemo", { defaultValue: "Request a demo" })}
              </button>
            }
          />
        }
      />
      <CardSection
        ariaLabel={t("expertise.previewAriaLabel", {
          defaultValue: `${entryLabel} preview`,
          label: entryLabel,
        })}
      >
        <MetalCard
          wide
          gradient={135}
          align="center"
          media={<div className={styles.screenPlaceholder} aria-hidden="true" />}
        />
      </CardSection>
      <Section
        ariaLabel={t("expertise.overviewAriaLabel", {
          defaultValue: `${entryLabel} overview`,
          label: entryLabel,
        })}
        fullHeight={false}
      >
        <TextCard
          level="h2"
          headline={t("expertise.overview", { defaultValue: "Overview" })}
          subhead={entryOverview}
        />
      </Section>
      <Section
        ariaLabel={t("expertise.useCasesAriaLabel", {
          defaultValue: `${entryLabel} use cases`,
          label: entryLabel,
        })}
        fullHeight={false}
      >
        <TextCard
          level="h2"
          headline={t("expertise.useCases", { defaultValue: "Use cases" })}
        />
      </Section>
      <CardSection
        ariaLabel={t("expertise.useCasesAriaLabel", {
          defaultValue: `${entryLabel} use cases`,
          label: entryLabel,
        })}
      >
        {entry.useCases.map((useCase, index) => (
          <MetalCard
            key={useCase.title}
            gradient={135}
            className={styles.useCaseCard}
            title={t(`expertise.entries.${entry.slug}.useCases.${index}.title`, {
              defaultValue: useCase.title,
            })}
            description={t(
              `expertise.entries.${entry.slug}.useCases.${index}.description`,
              {
                defaultValue: useCase.description,
              },
            )}
          />
        ))}
      </CardSection>
      <PrivacyFeaturePanel />
      <ChangelogPreview />
      <ProductCallToAction />
      <MarketingFooter />
    </div>
  );
}
