import { Text, Badge, Button } from "@cypher-asi/zui";
import { ArrowLeft, Check, Loader2, Terminal, Key, Settings } from "lucide-react";
import { SkillIcon } from "./SkillIcon";
import { SecurityBadge } from "./SecurityBadge";
import type { SkillStoreCatalogEntry } from "../../types";
import styles from "./SkillStoreModal.module.css";

interface SkillStoreDetailProps {
  entry: SkillStoreCatalogEntry;
  installed: boolean;
  installing: boolean;
  onBack: () => void;
  onInstall: () => void;
}

export function SkillStoreDetail({
  entry,
  installed,
  installing,
  onBack,
  onInstall,
}: SkillStoreDetailProps) {
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
            <Badge variant="pending">{entry.category}</Badge>
            <SecurityBadge rating={entry.security_rating} size="md" />
          </div>
        </div>
        <div className={styles.detailInstallArea}>
          {installed ? (
            <Badge variant="running" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Check size={12} /> Installed
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onInstall}
              disabled={installing}
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

        {entry.tags.length > 0 && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Tags</Text>
            <div className={styles.detailTags}>
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="pending" style={{ fontSize: 10 }}>{tag}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
