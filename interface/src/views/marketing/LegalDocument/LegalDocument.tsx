import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./LegalDocument.module.css";

interface LegalSection {
  readonly heading: string;
  readonly body: readonly string[];
}

interface LegalDocumentProps {
  /**
   * `marketing` namespace key prefix for this document, e.g. `"terms"`
   * or `"privacy"`. The component reads `<prefix>.intro`,
   * `<prefix>.effectiveDate`, `<prefix>.sections`, and the
   * `<prefix>.contact*` keys beneath it.
   */
  readonly prefix: "terms" | "privacy";
  /** Legal entity name, e.g. `"CYPHER, INC."`. */
  readonly company: string;
  /** Governing-law state, e.g. `"Nevada"`. */
  readonly state: string;
  /** Contact email, e.g. `"support@aura.ai"`. */
  readonly email: string;
}

/**
 * Shared renderer for the `/terms` and `/privacy` legal pages. The full
 * document body lives in the `marketing` i18n namespace as structured
 * `sections` (heading + paragraph array), so it flows through the
 * existing machine-translation pipeline into all locales.
 *
 * Proper nouns (company, governing-law state, contact email) and the
 * effective date are kept OUT of the translated strings via `{{company}}`
 * / `{{state}}` / `{{email}}` interpolation tokens, which both i18next and
 * the translation script preserve verbatim. We additionally fill the
 * tokens locally so the rendered copy is correct regardless of whether
 * i18next interpolates inside `returnObjects` payloads.
 */
export function LegalDocument({
  prefix,
  company,
  state,
  email,
}: LegalDocumentProps): ReactNode {
  const { t } = useTranslation("marketing");

  const fill = (value: string): string =>
    value
      .replace(/\{\{\s*company\s*\}\}/g, company)
      .replace(/\{\{\s*state\s*\}\}/g, state)
      .replace(/\{\{\s*email\s*\}\}/g, email);

  const sections = t(`${prefix}.sections`, {
    returnObjects: true,
    defaultValue: [],
  }) as unknown as LegalSection[];

  const effectiveDate = t(`${prefix}.effectiveDate`, { defaultValue: "" });
  const intro = fill(t(`${prefix}.intro`, { defaultValue: "" }));
  const contactHeading = t(`${prefix}.contactHeading`, {
    defaultValue: "Contact us",
  });
  const contactBody = fill(t(`${prefix}.contactBody`, { defaultValue: "" }));

  return (
    <section className={styles.page}>
      <div className={styles.document}>
        {effectiveDate ? (
          <p className={styles.effectiveDate}>{effectiveDate}</p>
        ) : null}
        {intro ? <p className={styles.intro}>{intro}</p> : null}

        {Array.isArray(sections)
          ? sections.map((section, index) => (
              <div key={section.heading ?? index} className={styles.section}>
                <h2 className={styles.sectionHeading}>{fill(section.heading)}</h2>
                {section.body.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex} className={styles.paragraph}>
                    {fill(paragraph)}
                  </p>
                ))}
              </div>
            ))
          : null}

        {contactBody ? (
          <div className={styles.section}>
            <h2 className={styles.sectionHeading}>{contactHeading}</h2>
            <p className={styles.paragraph}>{contactBody}</p>
            <a className={styles.contactEmail} href={`mailto:${email}`}>
              {email}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
