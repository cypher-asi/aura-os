import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanguageStore } from "../../stores/language-store";
import { LANGUAGES, getLanguageDef } from "../../i18n/languages";
import styles from "./LanguageDropdownButton.module.css";

const DROPDOWN_MAX_HEIGHT = 320;

/**
 * Public-shell language switcher, seated in the bottom taskbar's
 * right cluster. Reads/writes the shared `language-store`, so it stays
 * in sync with the Settings > Language section. The menu flips up from
 * the trigger to sit above the taskbar rather than off-screen below it.
 */
export function LanguageDropdownButton(): React.ReactElement {
  const { t } = useTranslation("common");
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  const active = getLanguageDef(language);
  const shortCode = (active?.code ?? language).split("-")[0].toUpperCase();

  // Flip-up anchor: the menu sits above the trigger (taskbar is at the
  // bottom of the viewport), so we position by distance from the bottom.
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
  }, []);

  // Measure at click time (not in an effect) so opening the menu performs a
  // single render with the position already computed.
  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
          setPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
        }
      }
      return next;
    });
  }, []);

  // Reposition on scroll/resize and close on Escape while open. `reposition`
  // only runs from event handlers, never synchronously inside the effect.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, reposition]);

  const handleSelect = (code: string) => {
    setLanguage(code);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const label = t("language", { defaultValue: "Language" });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${active?.nativeName ?? language}`}
        title={label}
      >
        <Globe size={14} aria-hidden="true" />
        <span className={styles.code}>{shortCode}</span>
      </button>

      {open &&
        createPortal(
          <>
            <div className={styles.overlay} onClick={() => setOpen(false)} />
            {pos && (
              <div
                className={styles.dropdown}
                role="listbox"
                aria-label={label}
                style={{ bottom: pos.bottom, left: pos.left, maxHeight: DROPDOWN_MAX_HEIGHT }}
              >
                {LANGUAGES.map((lang) => {
                  const selected = lang.code === language;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      lang={lang.code}
                      dir={lang.dir}
                      className={`${styles.option}${selected ? ` ${styles.optionSelected}` : ""}`}
                      onClick={() => handleSelect(lang.code)}
                    >
                      <span className={styles.optionText}>
                        <span className={styles.optionNative}>{lang.nativeName}</span>
                        <span className={styles.optionEnglish}>{lang.englishName}</span>
                      </span>
                      {selected && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
