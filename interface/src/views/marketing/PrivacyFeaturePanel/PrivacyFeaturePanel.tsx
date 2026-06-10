import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FeaturePanel } from "../FeaturePanel/FeaturePanel";

/**
 * The shared "Designed for your privacy." section — the canonical
 * privacy cards (Private / Verifiable / Open Source) used across the
 * public marketing surfaces. The Agents page (`ProductView`) is the
 * reference; every other page (`ExpertiseDetailView`, ...) renders this
 * single component so the cards stay byte-identical everywhere. Edit
 * the copy here once to update it on every surface.
 */
export function PrivacyFeaturePanel(): ReactNode {
  const { t } = useTranslation("marketing");
  return (
    <FeaturePanel
      headline={t("sections.privacy.headline", {
        defaultValue: "Designed for your humanity.",
      })}
      features={[
        {
          title: t("sections.privacy.features.private.title", {
            defaultValue: "Private",
          }),
          description:
            t("sections.privacy.features.private.description", {
              defaultValue:
                "AURA never views or trains on your personal or corporate data. Anything sent to frontier models stays unidentifiable.",
            }),
          tag: t("sections.privacy.features.private.tag", {
            defaultValue: "PQ-Encryption",
          }),
          shape: "circle",
        },
        {
          title: t("sections.privacy.features.verifiable.title", {
            defaultValue: "Verifiable",
          }),
          description:
            t("sections.privacy.features.verifiable.description", {
              defaultValue:
                "The AURA harness and kernel are built from the ground up with security, verification, and policy as first-class citizens.",
            }),
          tag: t("sections.privacy.features.verifiable.tag", {
            defaultValue: "Trusted Execution",
          }),
          shape: "triangle",
        },
        {
          title: t("sections.privacy.features.openSource.title", {
            defaultValue: "Open Source",
          }),
          description:
            t("sections.privacy.features.openSource.description", {
              defaultValue:
                "AURA is 100% open source under the MIT license. Fork it anytime, with zero vendor lock-in and no strings attached.",
            }),
          tag: t("sections.privacy.features.openSource.tag", {
            defaultValue: "MIT License",
          }),
          shape: "square",
        },
      ]}
    />
  );
}
