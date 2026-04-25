import { useState, useEffect, useRef, useCallback } from "react";
import { Text, Badge, Button } from "@cypher-asi/zui";
import { ArrowLeft, Check, Loader2, SquareTerminal, Key, Settings, FileText, FolderOpen, Wrench, Plus, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillIcon } from "./SkillIcon";
import { SecurityBadge } from "./SecurityBadge";
import { apiFetch, apiFetchText } from "../../shared/api/core";
import type { SkillShopCatalogEntry } from "../../shared/types";
import styles from "./SkillShopDetail.module.css";
import mdStyles from "../Preview/Preview.module.css";

function stripFrontmatter(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return raw;
  const end = trimmed.indexOf("---", 3);
  if (end === -1) return raw;
  return trimmed.slice(end + 3).trimStart();
}

export interface SkillInstallPermissions {
  paths: string[];
  commands: string[];
}

interface SkillShopDetailProps {
  entry: SkillShopCatalogEntry;
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
  onBack: () => void;
  onInstall: (perms: SkillInstallPermissions) => void;
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

  const [approvedPaths, setApprovedPaths] = useState<string[]>([]);
  const [approvedCommands, setApprovedCommands] = useState<string[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [discoveredPaths, setDiscoveredPaths] = useState<string[]>([]);

  useEffect(() => {
    setApprovedPaths(entry.permissions?.paths ?? []);
    setApprovedCommands(entry.permissions?.commands ?? []);
    setNewPath("");
    setNewCommand("");
  }, [entry.name, entry.permissions]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ paths: string[] }>(`/api/skills/${entry.name}/discover-paths`)
      .then((data) => {
        if (cancelled || !data?.paths?.length) return;
        setDiscoveredPaths(data.paths);
        setApprovedPaths((prev) => {
          const set = new Set(prev);
          for (const p of data.paths) set.add(p);
          return [...set];
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry.name]);

  const addPath = useCallback(() => {
    const p = newPath.trim();
    if (!p) return;
    setApprovedPaths((prev) => prev.includes(p) ? prev : [...prev, p]);
    setNewPath("");
  }, [newPath]);

  const removePath = useCallback((p: string) => {
    setApprovedPaths((prev) => prev.filter((x) => x !== p));
  }, []);

  const addCommand = useCallback(() => {
    const c = newCommand.trim();
    if (!c) return;
    setApprovedCommands((prev) => prev.includes(c) ? prev : [...prev, c]);
    setNewCommand("");
  }, [newCommand]);

  const removeCommand = useCallback((c: string) => {
    setApprovedCommands((prev) => prev.filter((x) => x !== c));
  }, []);

  useEffect(() => {
    if (!sourceOpen) return;
    const cacheKey = `${entry.category}/${entry.name}`;
    if (fetchedUrlRef.current === cacheKey && sourceContent !== null) return;

    let cancelled = false;
    setSourceLoading(true);
    setSourceError(false);
    apiFetchText(`/api/skills/${entry.category}/${entry.name}/content`)
      .then((text) => {
        if (cancelled) return;
        fetchedUrlRef.current = cacheKey;
        setSourceContent(text);
      })
      .catch(() => {
        if (!cancelled) setSourceError(true);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => { cancelled = true; };
  }, [sourceOpen, entry.category, entry.name, sourceContent]);

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
            {entry.os !== "any" && (
              <span className={styles.osBadge}>{entry.os}</span>
            )}
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
              onClick={() => onInstall({ paths: approvedPaths, commands: approvedCommands })}
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

        {!installed && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Approved Paths</Text>
            <Text size="xs" variant="muted" style={{ marginTop: 2, marginBottom: 6 }}>
              Directories this skill can read/write. Add your data paths here.
            </Text>
            <div className={styles.detailRequirements}>
              {approvedPaths.map((p) => (
                <div key={p} className={styles.requirementItem}>
                  <FolderOpen size={12} />
                  <Text size="sm" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }}>{p}</Text>
                  {discoveredPaths.includes(p) && <Badge variant="running" style={{ fontSize: 9 }}>discovered</Badge>}
                  <button type="button" className={styles.permRemoveBtn} onClick={() => removePath(p)} title="Remove">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <div className={styles.permAddRow}>
                <input
                  type="text"
                  className={styles.permAddInput}
                  placeholder="C:\path\to\directory"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPath()}
                />
                <button type="button" className={styles.permAddBtn} onClick={addPath} title="Add path">
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {!installed && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Approved Commands</Text>
            <Text size="xs" variant="muted" style={{ marginTop: 2, marginBottom: 6 }}>
              Shell commands this skill is allowed to execute.
            </Text>
            <div className={styles.detailRequirements}>
              {approvedCommands.map((c) => (
                <div key={c} className={styles.requirementItem}>
                  <SquareTerminal size={12} />
                  <Text size="sm" style={{ flex: 1 }}>{c}</Text>
                  <button type="button" className={styles.permRemoveBtn} onClick={() => removeCommand(c)} title="Remove">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <div className={styles.permAddRow}>
                <input
                  type="text"
                  className={styles.permAddInput}
                  placeholder="command prefix"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCommand()}
                />
                <button type="button" className={styles.permAddBtn} onClick={addCommand} title="Add command">
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {entry.permissions?.tools && entry.permissions.tools.length > 0 && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Tools Used</Text>
            <div className={styles.detailRequirements}>
              {entry.permissions.tools.map((t) => (
                <div key={t} className={styles.requirementItem}>
                  <Wrench size={12} />
                  <Text size="sm">{t}</Text>
                  <Badge variant="pending" style={{ fontSize: 9 }}>tool</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {entry.requires && (
          <div className={styles.detailSection}>
            <Text size="xs" variant="muted" weight="medium">Requirements</Text>
            <div className={styles.detailRequirements}>
              {entry.requires.bins?.map((bin) => (
                <div key={bin} className={styles.requirementItem}>
                  <SquareTerminal size={12} />
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
