import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Search } from "lucide-react";
import { SkillShopCategories } from "./SkillShopCategories";
import { SkillShopGrid } from "./SkillShopGrid";
import { SkillShopDetail, type SkillInstallPermissions } from "./SkillShopDetail";
import { OsFilterBar } from "./OsFilterBar";
import { api } from "../../api/client";
import catalogData from "../../data/skill-shop-catalog.json";
import type { SkillCategory, SkillOS, SkillShopCatalogEntry } from "../../shared/types";
import styles from "./SkillShopModal.module.css";

const catalog = catalogData as SkillShopCatalogEntry[];

function detectCurrentOS(): SkillOS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  if (ua.includes("linux")) return "linux";
  return "any";
}

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
  const [osFilter, setOsFilter] = useState<SkillOS | "all">(detectCurrentOS());
  const [selected, setSelected] = useState<SkillShopCatalogEntry | null>(null);
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      syncedRef.current = false;
      return;
    }
    if (!syncedRef.current && initialInstalledNames) {
      setInstalledNames(new Set(initialInstalledNames));
      syncedRef.current = true;
    }
  }, [isOpen, initialInstalledNames]);

  const filtered = useMemo(() => {
    let result = catalog;
    if (osFilter !== "all") {
      result = result.filter((e) => e.os === "any" || e.os === osFilter);
    }
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
  }, [category, osFilter, search]);

  const handleInstall = useCallback(async (entry: SkillShopCatalogEntry, perms?: SkillInstallPermissions) => {
    setInstalling(true);
    try {
      await api.harnessSkills.installFromShop(entry.name, entry.category);
      if (agentId) {
        await api.harnessSkills.installAgentSkill(
          agentId,
          entry.name,
          undefined,
          perms?.paths,
          perms?.commands,
        );
      }
      setInstalledNames((prev) => new Set(prev).add(entry.name));
      onInstalled?.();
    } catch {
      setInstalledNames((prev) => new Set(prev).add(entry.name));
      onInstalled?.();
    }
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
    setOsFilter(detectCurrentOS());
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

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
          <OsFilterBar selected={osFilter} onSelect={setOsFilter} />
          <button type="button" className={styles.closeBtn} title="Close" onClick={handleClose}>
            <X size={13} />
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
                onInstall={(perms) => handleInstall(selected, perms)}
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
