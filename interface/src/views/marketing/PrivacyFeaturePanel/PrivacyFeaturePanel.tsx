import { type ReactNode } from "react";
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
  return (
    <FeaturePanel
      headline="Designed for your privacy."
      features={[
        {
          title: "Private",
          description:
            "AURA never views or trains on your personal or corporate data. Anything sent to frontier models stays unidentifiable.",
          tag: "PQ-Encryption",
          shape: "circle",
        },
        {
          title: "Verifiable",
          description:
            "The AURA harness and kernel are built from the ground up with security, verification, and policy as first-class citizens.",
          tag: "Trusted Execution",
          shape: "triangle",
        },
        {
          title: "Open Source",
          description:
            "AURA is 100% open source under the MIT license. Fork it anytime, with zero vendor lock-in and no strings attached.",
          tag: "MIT License",
          shape: "square",
        },
      ]}
    />
  );
}
