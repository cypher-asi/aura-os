import { useState, useEffect, useMemo, useCallback } from "react";
import { X, Search } from "lucide-react";
import { SkillShopCategories } from "./SkillShopCategories";
import { SkillShopGrid } from "./SkillShopGrid";
import { SkillShopDetail } from "./SkillShopDetail";
import { api } from "../../api/client";
import catalogData from "../../data/skill-shop-catalog.json";
import type { SkillCategory, SkillShopCatalogEntry } from "../../types";
import styles from "./SkillShopModal.module.css";

const catalog = catalogData as SkillShopCatalogEntry[];

interface SkillShopModalProps {
  isOpen: boolean;
  agentId?: string;
  initialInstalledNames?: Set<string>;
  onClose: () => void;
  onInstalled?: () => void;
}

export function SkillShopModal({ isOpen, agentId, initialInstalledNames, onClose, onInstalled }: SkillShopModalProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<SkillCategory | "all">("all");
  const [selected, setSelected] = useState<SkillShopCatalogEntry | null>(null);
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  useEffect(() => {
    if (isOpen && initialInstalledNames) {
      setInstalledNames((prev) => {
        const merged = new Set(prev);
        for (const n of initialInstalledNames) merged.add(n);
        return merged;
      });
    }
  }, [isOpen, initialInstalledNames]);

  const filtered = useMemo(() => {
    let result = catalog;
    if (category !== "all") {
      result = result.filter((e) => e.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.includes(q)),
      );
    }
    return result;
  }, [category, search]);

  const handleInstall = useCallback(async (entry: SkillShopCatalogEntry) => {
    setInstalling(true);
    try {
      await api.harnessSkills.installFromShop(entry.name, entry.source_url);
      if (agentId) {
        await api.harnessSkills.installAgentSkill(agentId, entry.name, entry.source_url).catch(() => {});
      }
      setInstalledNames((prev) => new Set(prev).add(entry.name));
      onInstalled?.();
    } catch { /* best-effort */ }
    setInstalling(false);
  }, [agentId, onInstalled]);

  const handleUninstall = useCallback(async (entry: SkillShopCatalogEntry) => {
    if (!agentId) return;
    setUninstalling(true);
    try {
      await api.harnessSkills.uninstallAgentSkill(agentId, entry.name);
      setInstalledNames((prev) => {
        const next = new Set(prev);
        next.delete(entry.name);
        return next;
      });
      onInstalled?.();
    } catch { /* best-effort */ }
    setUninstalling(false);
  }, [agentId, onInstalled]);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSearch("");
    setCategory("all");
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.topBar}>
          <span className={styles.title}>Skill Shop</span>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="button" className={styles.closeBtn} onClick={handleClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            <SkillShopCategories
              catalog={catalog}
              selected={category}
              onSelect={(c) => { setCategory(c); setSelected(null); }}
            />
          </div>

          <div className={styles.content}>
            {selected ? (
              <SkillShopDetail
                entry={selected}
                installed={installedNames.has(selected.name)}
                installing={installing}
                uninstalling={uninstalling}
                onBack={() => setSelected(null)}
                onInstall={() => handleInstall(selected)}
                onUninstall={() => handleUninstall(selected)}
              />
            ) : (
              <SkillShopGrid
                entries={filtered}
                installedNames={installedNames}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
