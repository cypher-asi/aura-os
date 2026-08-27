import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Modal, Spinner } from "@cypher-asi/zui";
import {
  Bot,
  Command,
  CornerDownLeft,
  Folder,
  MessageSquare,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apps } from "../../apps/registry";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { filterRuntimeVisibleAgents } from "../../shared/lib/agent-runtime-visibility";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { formatShortcut, type ShortcutSpec } from "../../lib/platform";
import { useProjectsListStore } from "../../stores/projects-list-store";
import {
  isOptimisticSessionId,
  useSessionsForSurface,
  useSessionsListStore,
  useSessionsLoading,
  userSessionsSurfaceKey,
} from "../../stores/sessions-list-store";
import { deriveSessionLabel } from "../SessionsList/session-row-utils";
import {
  MENU_DEFINITIONS,
  NATIVE_EDIT_ACTIONS,
} from "../MenuBar/menu-config";
import { useMenuActions } from "../MenuBar/use-menu-actions";
import {
  filterPaletteGroups,
  flattenPaletteGroups,
  nextEnabledPaletteIndex,
  type PaletteSearchGroup,
  type PaletteSearchItem,
} from "./command-palette-logic";
import styles from "./CommandPalette.module.css";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandPaletteItem extends PaletteSearchItem {
  icon: ReactNode;
  shortcut?: ShortcutSpec;
  run: () => void | Promise<void>;
}

const EMPTY_GROUP_LIMITS: Record<string, number> = {
  chats: 10,
  apps: 12,
  projects: 8,
  agents: 8,
  actions: 12,
};

const SEARCH_GROUP_LIMIT = 20;

function resultGroups(
  groups: readonly PaletteSearchGroup<CommandPaletteItem>[],
  query: string,
): PaletteSearchGroup<CommandPaletteItem>[] {
  const filtered = filterPaletteGroups(groups, query);
  const emptyQuery = query.trim().length === 0;
  return filtered.map((group) => ({
    ...group,
    items: group.items.slice(
      0,
      emptyQuery
        ? (EMPTY_GROUP_LIMITS[group.id] ?? SEARCH_GROUP_LIMIT)
        : SEARCH_GROUP_LIMIT,
    ),
  }));
}

function sessionTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

/**
 * Global, keyboard-first discovery surface for the actions and cached product
 * entities Aura already knows about. The palette never owns domain state: it
 * composes the existing menu action registry and navigates to canonical app,
 * project, agent, and session routes.
 */
export function CommandPalette({
  isOpen,
  onClose,
}: CommandPaletteProps): React.ReactElement | null {
  const navigate = useNavigate();
  const { remoteOnly } = useAuraCapabilities();
  const { actions, isItemDisabled } = useMenuActions();
  const projects = useProjectsListStore((state) => state.projects);
  const agents = useAgentStore((state) => state.agents);
  const userSessionsKey = userSessionsSurfaceKey();
  const sessions = useSessionsForSurface(userSessionsKey);
  const sessionsLoading = useSessionsLoading(userSessionsKey);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const requestedSessionsRef = useRef(false);

  useEffect(() => {
    if (!isOpen || requestedSessionsRef.current || sessions.length > 0) return;
    requestedSessionsRef.current = true;
    void useSessionsListStore.getState().loadUserSessions();
  }, [isOpen, sessions.length]);

  const visibleAgents = useMemo(
    () => filterRuntimeVisibleAgents(agents, remoteOnly),
    [agents, remoteOnly],
  );

  const groups = useMemo<PaletteSearchGroup<CommandPaletteItem>[]>(() => {
    const agentNameById = new Map(
      agents.map((agent) => [agent.agent_id, agent.name]),
    );

    const chatItems = sessions
      .filter((session) => !isOptimisticSessionId(session.session_id))
      .map<CommandPaletteItem>((session) => {
        const title = deriveSessionLabel(session, undefined);
        const projectLabel = session._projectName || "Project chat";
        const agentLabel = session._agentId
          ? agentNameById.get(session._agentId)
          : undefined;
        const metadata = [
          projectLabel,
          agentLabel,
          sessionTimestamp(session.started_at),
        ].filter(Boolean);
        return {
          id: `chat:${session.session_id}`,
          title,
          subtitle: metadata.join(" · "),
          searchTerms: [
            projectLabel,
            agentLabel ?? "",
            session.model ?? "",
            session.summary_of_previous_context,
          ],
          icon: <MessageSquare size={16} aria-hidden="true" />,
          run: () => {
            const params = new URLSearchParams({ session: session.session_id });
            navigate(
              `/projects/${session._projectId}/agents/${session._agentInstanceId}?${params.toString()}`,
            );
          },
        };
      });

    const appItems = apps
      .filter((app) => !app.adminOnly && !app.defaultHidden)
      .map<CommandPaletteItem>((app) => {
        const AppIcon = app.icon;
        return {
          id: `app:${app.id}`,
          title: app.label,
          subtitle: app.agentDescription,
          searchTerms: [
            app.id,
            app.basePath,
            ...(app.agentKeywords ?? []),
          ],
          icon: <AppIcon size={16} aria-hidden="true" />,
          run: () => navigate(app.basePath),
        };
      });

    const projectItems = projects.map<CommandPaletteItem>((project) => ({
      id: `project:${project.project_id}`,
      title: project.name,
      subtitle:
        project.description ||
        project.local_workspace_path ||
        project.git_repo_url ||
        "Build workspace",
      searchTerms: [
        project.project_id,
        project.git_branch ?? "",
        project.git_repo_url ?? "",
        project.local_workspace_path ?? "",
        project.current_status,
      ],
      icon: <Folder size={16} aria-hidden="true" />,
      run: () => navigate(`/projects/${project.project_id}`),
    }));

    const agentItems = visibleAgents.map<CommandPaletteItem>((agent) => ({
      id: `agent:${agent.agent_id}`,
      title: agent.name,
      subtitle: agent.role || "Agent",
      searchTerms: [
        agent.agent_id,
        agent.machine_type,
        agent.adapter_type,
        agent.environment,
        ...agent.skills,
        ...agent.tags,
      ],
      icon: <Bot size={16} aria-hidden="true" />,
      run: () => navigate(`/agents/${agent.agent_id}`),
    }));

    const actionItems = MENU_DEFINITIONS.flatMap((menu) =>
      menu.entries.flatMap<CommandPaletteItem>((entry) => {
        if (entry.type !== "item") return [];
        if (NATIVE_EDIT_ACTIONS.has(entry.id)) return [];
        if (entry.id === "view.commandPalette") return [];
        return [
          {
            id: `action:${entry.id}`,
            title: entry.label,
            subtitle: menu.label,
            searchTerms: [entry.id, menu.id, menu.label],
            disabled: isItemDisabled(entry.id),
            shortcut: entry.shortcut,
            icon: <Command size={16} aria-hidden="true" />,
            run: actions[entry.id],
          },
        ];
      }),
    );

    return [
      { id: "chats", label: "Recent chats", items: chatItems },
      { id: "apps", label: "Apps", items: appItems },
      { id: "projects", label: "Projects", items: projectItems },
      { id: "agents", label: "Agents", items: agentItems },
      { id: "actions", label: "Actions", items: actionItems },
    ];
  }, [actions, agents, isItemDisabled, navigate, projects, sessions, visibleAgents]);

  const filteredGroups = useMemo(() => resultGroups(groups, query), [groups, query]);
  const flatItems = useMemo(
    () => flattenPaletteGroups(filteredGroups),
    [filteredGroups],
  );
  const firstEnabledIndex = flatItems.findIndex((item) => !item.disabled);
  const resolvedActiveIndex =
    activeIndex >= 0 &&
    activeIndex < flatItems.length &&
    !flatItems[activeIndex]?.disabled
      ? activeIndex
      : firstEnabledIndex;
  const indexById = useMemo(
    () => new Map(flatItems.map((item, index) => [item.id, index])),
    [flatItems],
  );

  useEffect(() => {
    if (resolvedActiveIndex < 0) return;
    const active = resultsRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${resolvedActiveIndex}"]`,
    );
    active?.scrollIntoView?.({ block: "nearest" });
  }, [resolvedActiveIndex]);

  const activate = useCallback(
    (item: CommandPaletteItem | undefined) => {
      if (!item || item.disabled) return;
      onClose();
      void Promise.resolve(item.run()).catch((error) => {
        console.error(`Command palette action ${item.id} failed`, error);
      });
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          nextEnabledPaletteIndex(
            flatItems,
            current >= 0 ? current : resolvedActiveIndex,
            event.key === "ArrowDown" ? 1 : -1,
          ),
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        activate(flatItems[resolvedActiveIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [activate, flatItems, onClose, resolvedActiveIndex],
  );

  if (!isOpen) return null;

  const renderedGroups = filteredGroups.map((group) => {
    return (
      <section key={group.id} className={styles.group} aria-label={group.label}>
        <div className={styles.groupLabel}>{group.label}</div>
        <div className={styles.groupItems}>
          {group.items.map((item, index) => {
            const absoluteIndex = indexById.get(item.id) ?? index;
            const active = absoluteIndex === resolvedActiveIndex;
            return (
              <button
                key={item.id}
                id={`aura-palette-${absoluteIndex}`}
                type="button"
                role="option"
                aria-selected={active}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                data-palette-index={absoluteIndex}
                className={`${styles.item} ${active ? styles.itemActive : ""}`}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIndex(absoluteIndex);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => activate(item)}
              >
                <span className={styles.itemIcon}>{item.icon}</span>
                <span className={styles.itemCopy}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  {item.subtitle ? (
                    <span className={styles.itemSubtitle}>{item.subtitle}</span>
                  ) : null}
                </span>
                {item.shortcut ? (
                  <kbd className={styles.shortcut}>{formatShortcut(item.shortcut)}</kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>
    );
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Command palette"
      subtitle={formatShortcut({ key: "k", mod: true })}
      size="lg"
      noPadding
      className={styles.paletteModal}
      contentClassName={styles.paletteContent}
      initialFocusRef={inputRef as RefObject<HTMLElement>}
    >
      <div className={styles.searchRow}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search chats, apps, projects, agents, and actions"
          aria-label="Search command palette"
          role="combobox"
          aria-expanded="true"
          aria-controls="aura-command-palette-results"
          aria-activedescendant={
            resolvedActiveIndex >= 0
              ? `aura-palette-${resolvedActiveIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div
        id="aura-command-palette-results"
        ref={resultsRef}
        className={styles.results}
        role="listbox"
      >
        {renderedGroups.length > 0 ? (
          renderedGroups
        ) : (
          <div className={styles.empty}>
            {sessionsLoading ? <Spinner size="sm" /> : null}
            <span>{sessionsLoading ? "Loading recent chats…" : "No matches found."}</span>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd><CornerDownLeft size={12} aria-hidden="true" /></kbd> Open</span>
        <span><kbd>&gt;</kbd> Actions only</span>
      </footer>
    </Modal>
  );
}
