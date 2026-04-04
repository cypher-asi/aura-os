import { useState, useEffect, useRef } from "react";
import { Text, Badge, Button } from "@cypher-asi/zui";
import { ArrowLeft, Check, Loader2, Terminal, Key, Settings, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillIcon } from "./SkillIcon";
import { SecurityBadge } from "./SecurityBadge";
import type { SkillShopCatalogEntry } from "../../types";
import styles from "./SkillShopModal.module.css";
import mdStyles from "../Preview/Preview.module.css";

function stripFrontmatter(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return raw;
  const end = trimmed.indexOf("---", 3);
  if (end === -1) return raw;
  return trimmed.slice(end + 3).trimStart();
}

interface SkillShopDetailProps {
  entry: SkillShopCatalogEntry;
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
  onBack: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}

export function SkillShopDetail({
  entry,
  installed,
  installing,
  uninstalling,
  onBack,
  onInstall,
  onUninstall,
}: SkillShopDetailProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceContent, setSourceContent] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const fetchedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceOpen || !entry.source_url) return;
    if (fetchedUrlRef.current === entry.source_url && sourceContent !== null) return;

    let cancelled = false;
    setSourceLoading(true);
    setSourceError(false);
    fetch(entry.source_url)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        fetchedUrlRef.current = entry.source_url;
        setSourceContent(text);
      })
      .catch(() => {
        if (!cancelled) setSourceError(true);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => { cancelled = true; };
  }, [sourceOpen, entry.source_url, sourceContent]);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.detailBack} onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <div className={styles.detailIcon}>
          <SkillIcon name={entry.name} size={32} />
        </div>
        <div className={styles.detailTitleBlock}>
          <div className={styles.detailName}>{entry.name}</div>
          <div className={styles.detailCategory}>
            <span className={styles.detailCategoryLabel}>{entry.category}</span>
            <SecurityBadge rating={entry.security_rating} size="md" />
          </div>
        </div>
        <div className={styles.detailInstallArea}>
          {installed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUninstall}
              disabled={uninstalling}
              style={{ background: "transparent", borderColor: "rgba(255,255,255,0.25)", color: "var(--color-text-secondary)" }}
            >
              {uninstalling ? (
                <><Loader2 size={14} className={styles.spin} /> Removing...</>
              ) : (
                <><Check size={14} /> Installed</>
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onInstall}
              disabled={installing}
              style={{ background: "transparent", borderColor: "rgba(255,255,255,0.6)", color: "#fff" }}
            >
              {installing ? (
                <><Loader2 size={14} className={styles.spin} /> Installing...</>
              ) : (
                "Install"
              )}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.detailBody}>
        <div className={styles.detailSection}>
          <Text size="sm">{entry.description}</Text>
        </div>

        <div className={styles.detailSection}>
          <Text size="xs" variant="muted" weight="medium">Security Analysis</Text>
          <div className={styles.detailSecurityBox}>
            <SecurityBadge rating={entry.security_rating} size="md" />
            <Text size="sm" variant="secondary">{entry.security_notes}</Text>
          </div>
        </div>

        {entry.requires && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Requirements</Text>
            <div className={styles.detailRequirements}>
              {entry.requires.bins?.map((bin) => (
                <div key={bin} className={styles.requirementItem}>
                  <Terminal size={12} />
                  <Text size="sm">{bin}</Text>
                  <Badge variant="pending" style={{ fontSize: 9 }}>binary</Badge>
                </div>
              ))}
              {entry.requires.env?.map((env) => (
                <div key={env} className={styles.requirementItem}>
                  <Key size={12} />
                  <Text size="sm">{env}</Text>
                  <Badge variant="pending" style={{ fontSize: 9 }}>env var</Badge>
                </div>
              ))}
              {entry.requires.config?.map((cfg) => (
                <div key={cfg} className={styles.requirementItem}>
                  <Settings size={12} />
                  <Text size="sm">{cfg}</Text>
                  <Badge variant="pending" style={{ fontSize: 9 }}>config</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.detailSection}>
          <button
            type="button"
            className={styles.viewSourceBtn}
            onClick={() => setSourceOpen((v) => !v)}
          >
            <FileText size={13} />
            <Text size="xs" weight="medium">{sourceOpen ? "Hide" : "View"} Skill Source</Text>
          </button>

          {sourceOpen && (
            <div className={styles.sourcePanel}>
              {sourceLoading && (
                <div className={styles.sourcePlaceholder}>
                  <Loader2 size={14} className={styles.spin} />
                  <Text size="xs" variant="muted">Loading SKILL.md...</Text>
                </div>
              )}
              {sourceError && (
                <div className={styles.sourcePlaceholder}>
                  <Text size="xs" variant="muted">Failed to load skill source.</Text>
                </div>
              )}
              {!sourceLoading && !sourceError && sourceContent !== null && (
                <div className={mdStyles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stripFrontmatter(sourceContent)}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>

        {entry.tags.length > 0 && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Tags</Text>
            <div className={styles.detailTags}>
              {entry.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
