import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, File } from "lucide-react";
import { filterProjectFiles, type ProjectFile } from "./useProjectFiles";
import type { MentionableAgent } from "./useInputTriggers";
import styles from "./ChatInputBar.module.css";

type MentionItem =
  | { kind: "agent"; agent: MentionableAgent }
  | { kind: "file"; file: ProjectFile };

interface MentionMenuProps {
  query: string;
  agents: MentionableAgent[];
  files: ProjectFile[];
  onSelectAgent: (agent: MentionableAgent) => void;
  onSelectFile?: (file: ProjectFile) => void;
  onClose: () => void;
}

export const MentionMenu = memo(function MentionMenu({
  query,
  agents,
  files,
  onSelectAgent,
  onSelectFile,
  onClose,
}: MentionMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) =>
        `${agent.name} ${agent.role ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [agents, normalizedQuery],
  );
  const filteredFiles = useMemo(
    () => filterProjectFiles(files, query),
    [files, query],
  );
  const items = useMemo<MentionItem[]>(
    () => [
      ...filteredAgents.map((agent) => ({ kind: "agent" as const, agent })),
      ...filteredFiles.map((file) => ({ kind: "file" as const, file })),
    ],
    [filteredAgents, filteredFiles],
  );

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    const active = listRef.current?.querySelector(
      `.${styles.slashMenuItemActive}`,
    ) as HTMLElement | null;
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const selectItem = useCallback(
    (item: MentionItem | undefined) => {
      if (!item) return;
      if (item.kind === "agent") onSelectAgent(item.agent);
      else onSelectFile?.(item.file);
    },
    [onSelectAgent, onSelectFile],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (items.length === 0) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          onClose();
        }
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          event.stopImmediatePropagation();
          setActiveIndex((index) => (index + 1) % items.length);
          break;
        case "ArrowUp":
          event.preventDefault();
          event.stopImmediatePropagation();
          setActiveIndex((index) => (index - 1 + items.length) % items.length);
          break;
        case "Enter":
        case "Tab":
          event.preventDefault();
          event.stopImmediatePropagation();
          selectItem(items[activeIndex]);
          break;
        case "Escape":
          event.preventDefault();
          event.stopImmediatePropagation();
          onClose();
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeIndex, items, onClose, selectItem]);

  if (items.length === 0) {
    return (
      <div className={styles.slashMenu} ref={listRef}>
        <div className={styles.mentionMenuEmpty}>
          No matching agents or files
        </div>
      </div>
    );
  }

  let itemIndex = 0;
  return (
    <div
      className={styles.slashMenu}
      ref={listRef}
      aria-label="Mention an agent or file"
    >
      {filteredAgents.length > 0 ? (
        <div className={styles.mentionMenuSection}>
          <div className={styles.mentionMenuHeading}>Project agents</div>
          {filteredAgents.map((agent) => {
            const index = itemIndex++;
            return (
              <button
                key={agent.agent_instance_id}
                type="button"
                className={`${styles.slashMenuItem} ${styles.mentionMenuItem} ${index === activeIndex ? styles.slashMenuItemActive : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectAgent(agent);
                }}
              >
                <span className={styles.agentMentionAvatar} aria-hidden="true">
                  <Bot size={12} />
                </span>
                <span className={styles.slashMenuItemLabel}>{agent.name}</span>
                <span className={styles.slashMenuItemDesc}>
                  {agent.role || "Project agent"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {filteredFiles.length > 0 ? (
        <div className={styles.mentionMenuSection}>
          <div className={styles.mentionMenuHeading}>Project files</div>
          {filteredFiles.map((file) => {
            const index = itemIndex++;
            return (
              <button
                key={file.path}
                type="button"
                className={`${styles.slashMenuItem} ${styles.mentionMenuItem} ${index === activeIndex ? styles.slashMenuItemActive : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectFile?.(file);
                }}
              >
                <File size={12} className={styles.mentionMenuIcon} />
                <span className={styles.slashMenuItemLabel}>{file.name}</span>
                <span className={styles.slashMenuItemDesc}>
                  {file.relativePath}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
