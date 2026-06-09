import { type ReactNode, useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
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
  const { slug } = useParams<{ slug: string }>();
  const entry = slug ? getExpertiseEntry(slug) : undefined;

  useEffect(() => {
    if (!entry) return;
    const previousTitle = document.title;
    document.title = `AURA - ${entry.label}`;
    return () => {
      document.title = previousTitle;
    };
  }, [entry]);

  if (!entry) {
    return <Navigate to="/agents" replace />;
  }

  return (
    <div className={styles.expertiseView}>
      <MarketingFirstScreen
        hero={
          <PageHero
            label={entry.label}
            headline={entry.headline}
            description={entry.heroBlurb}
            preview={null}
            centered
            headlineCta={
              <button type="button" className={styles.demoButton}>
                Request a demo
              </button>
            }
          />
        }
      />
      <CardSection ariaLabel={`${entry.label} preview`}>
        <MetalCard
          wide
          gradient={135}
          align="center"
          media={<div className={styles.screenPlaceholder} aria-hidden="true" />}
        />
      </CardSection>
      <Section ariaLabel={`${entry.label} overview`} fullHeight={false}>
        <TextCard level="h2" headline="Overview" subhead={entry.overview} />
      </Section>
      <Section ariaLabel={`${entry.label} use cases`} fullHeight={false}>
        <TextCard level="h2" headline="Use cases" />
      </Section>
      <CardSection ariaLabel={`${entry.label} use cases`}>
        {entry.useCases.map((useCase) => (
          <MetalCard
            key={useCase.title}
            gradient={135}
            className={styles.useCaseCard}
            title={useCase.title}
            description={useCase.description}
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
