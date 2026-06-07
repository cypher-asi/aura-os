import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Heading,
  Item,
  Panel,
  Text,
} from "@cypher-asi/zui";
import {
  Bot,
  ChevronRight,
  ClipboardClock,
  CreditCard,
  FileCode2,
  Folder,
  FolderOpen,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Minus,
  Pause,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  SquareTerminal,
  Workflow,
  X,
} from "lucide-react";
import { ShellTitlebar } from "../../../components/ShellTitlebar";
import { PanelSearch } from "../../../components/PanelSearch";
import { AppSwitchToggle } from "../../../components/AppSwitchToggle";
import { ProfilePill } from "../../../components/BottomTaskbar/ProfilePill";
import { TaskbarIconButton } from "../../../components/AppNavRail/TaskbarIconButton";
import { Avatar } from "../../../components/Avatar";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import {
  EXPLORER_ROWS,
  FAVORITE_AGENTS,
  LOG_ROWS,
  TASK_ROWS,
  type MockLogCategory,
} from "./mock-data";
import styles from "./MockAuraDesktop.module.css";

/*
 * MockAuraDesktop — a static, non-interactive mock of the authenticated
 * AURA desktop shell (`AuraShell`), used as the decorative stage on the
 * `/code` marketing page. It reproduces the real shell's full chrome —
 * titlebar, left project sidebar, the Projects/Execution main panel, the
 * right sidekick rail, and the bottom taskbar — by REUSING the app's real
 * presentational components (`ShellTitlebar`, `PanelSearch`,
 * `AppSwitchToggle`, `ProfilePill`, `TaskbarIconButton`, `Avatar`,
 * `TaskStatusIcon`, and the zui design-system primitives) wired to
 * hardcoded mock data. Nothing here touches a store, socket, router, or
 * API; every handler is a no-op.
 *
 * The whole subtree is `aria-hidden` by its host (`MarketingFirstScreen
 * stageHidden`) — it is atmosphere, not interactive content, and the
 * page's accessible name is carried by the `PageHero` above it.
 */

const SIDEKICK_TABS: ReadonlyArray<{ id: string; title: string; icon: ReactNode }> = [
  { id: "chats", title: "Chats", icon: <MessageSquare size={16} /> },
  { id: "terminal", title: "Terminal", icon: <SquareTerminal size={16} /> },
  { id: "plans", title: "Plans", icon: <ClipboardClock size={16} /> },
  { id: "tasks", title: "Tasks", icon: <ListChecks size={16} /> },
  { id: "files", title: "Files", icon: <Folder size={16} /> },
];

const APP_RAIL: ReadonlyArray<{ id: string; title: string; icon: ReactNode; active?: boolean }> = [
  { id: "agents", title: "Agents", icon: <Bot size={17} /> },
  { id: "projects", title: "Projects", icon: <FolderOpen size={17} />, active: true },
  { id: "tasks", title: "Tasks", icon: <ListChecks size={17} /> },
  { id: "process", title: "Process", icon: <Workflow size={17} /> },
];

const TERMINAL_LINES: ReadonlyArray<{ text: string; dim?: boolean }> = [
  { text: "$ aura run --loop" },
  { text: "› planning next task", dim: true },
  { text: "› editing src/components/Dashboard.tsx", dim: true },
  { text: "› running test suite", dim: true },
  { text: "✓ 42 passing · build verified" },
  { text: "› committing changes", dim: true },
];

function formatClock(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function logBadgeClass(category: MockLogCategory): string {
  return `${styles.logBadge} ${styles[`logBadge_${category}`] ?? ""}`;
}

const noop = () => undefined;

function MockTitlebar(): ReactNode {
  return (
    <div className={styles.titlebar}>
      <ShellTitlebar
        onDoubleClick={noop}
        icon={
          <span className="titlebar-no-drag">
            <span className={styles.titleLeading}>
              <PanelLeft size={14} strokeWidth={2} />
            </span>
          </span>
        }
        title={
          <span className="titlebar-center">
            <img
              src="/AURA_logo_text_mark.png"
              alt="AURA"
              className={styles.titleLogo}
              draggable={false}
            />
          </span>
        }
        actions={
          <span className="titlebar-no-drag">
            <span className={styles.titleActions}>
              <span className={styles.titleIconButton}>
                <PanelRight size={14} strokeWidth={2} />
              </span>
              <span className={styles.titleIconButton}>
                <Minus size={12} strokeWidth={2} />
              </span>
              <span className={styles.titleIconButton}>
                <Square size={11} strokeWidth={2} />
              </span>
              <span className={styles.titleIconButton}>
                <X size={14} strokeWidth={2} />
              </span>
            </span>
          </span>
        }
      />
    </div>
  );
}

function MockSidebar(): ReactNode {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <PanelSearch placeholder="Search projects" value="" onChange={noop} />
        <div className={styles.appSwitchRow}>
          <AppSwitchToggle
            options={[
              { id: "agents", label: "Agents" },
              { id: "projects", label: "Projects" },
            ]}
            active="projects"
            onChange={noop}
            ariaLabel="Switch app"
          />
        </div>
      </div>
      <div className={styles.tree}>
        {EXPLORER_ROWS.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={`${styles.treeRow} ${row.active ? styles.treeRowActive : ""}`}
            style={{ paddingLeft: `${8 + row.depth * 13}px` }}
          >
            {row.kind === "folder-open" ? (
              <FolderOpen size={14} className={styles.treeIcon} />
            ) : row.kind === "folder" ? (
              <Folder size={14} className={styles.treeIcon} />
            ) : (
              <FileCode2 size={14} className={styles.treeIcon} />
            )}
            <span className={styles.treeLabel}>{row.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MockExecution(): ReactNode {
  return (
    <main className={styles.main}>
      <div className={styles.execution}>
        <div className={styles.statusBar}>
          <div className={styles.statusInlineRow}>
            <Badge variant="running" pulse>
              Connected
            </Badge>
          </div>
          <div className={styles.statusInlineRow}>
            <span className={styles.statusMutedText}>Agent:</span>
            <Text size="sm" as="span" weight="medium">
              Builder
            </Text>
            <Badge variant="running">working</Badge>
          </div>
          <div className={styles.statusInlineRow}>
            <span className={styles.statusMutedText}>Session:</span>
            <Text size="sm" as="span" weight="medium">
              #18
            </Text>
          </div>
          <div className={styles.statusAutoRight}>
            <span className={styles.statusMutedText}>Working on: </span>
            <Text size="sm" as="span">
              the dashboard layout
            </Text>
          </div>
        </div>

        <div className={styles.panels}>
          <Panel variant="solid" border="solid" className={styles.panelColumn}>
            <div className={styles.panelHeader}>
              <Heading level={5}>Task Feed ({TASK_ROWS.length})</Heading>
            </div>
            <div className={styles.feedList}>
              {TASK_ROWS.map((task) => (
                <Item
                  key={task.title}
                  selected={task.status === "in_progress" && !task.child}
                  style={task.child ? { paddingLeft: "var(--space-6, 24px)" } : undefined}
                >
                  <Item.Icon>
                    <TaskStatusIcon status={task.status} />
                  </Item.Icon>
                  <Item.Label>
                    <span className={styles.taskTitle}>
                      {task.child ? `↳ ${task.title}` : task.title}
                    </span>
                  </Item.Label>
                </Item>
              ))}
            </div>
          </Panel>

          <Panel variant="solid" border="solid" className={styles.panelColumn}>
            <div className={styles.panelHeader}>
              <Heading level={5}>Log Output</Heading>
            </div>
            <div className={styles.logContent}>
              {LOG_ROWS.map((entry, index) => (
                <div key={index} className={styles.logRow}>
                  <span className={styles.logTimestamp}>{entry.timestamp}</span>
                  <span className={logBadgeClass(entry.category)}>{entry.label}</span>
                  <span className={styles.logSummary}>{entry.summary}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className={styles.controlRow}>
          <Button variant="secondary" size="sm" icon={<Pause size={14} />} onClick={noop}>
            Pause
          </Button>
          <Button variant="danger" size="sm" icon={<Square size={14} />} onClick={noop}>
            Stop
          </Button>
        </div>
      </div>
    </main>
  );
}

function MockSidekick(): ReactNode {
  return (
    <aside className={styles.sidekick}>
      <div className={styles.sidekickTabs}>
        {SIDEKICK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            tabIndex={-1}
            title={tab.title}
            aria-label={tab.title}
            aria-pressed={tab.id === "terminal"}
            className={`${styles.sidekickTab} ${tab.id === "terminal" ? styles.sidekickTabActive : ""}`}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      <div className={styles.sidekickBody}>
        <span className={styles.terminalTitle}>Terminal · agent vm</span>
        <div className={styles.terminal}>
          {TERMINAL_LINES.map((line, index) => (
            <span
              key={index}
              className={line.dim ? styles.terminalDim : undefined}
            >
              {line.text}
            </span>
          ))}
          <span>
            <span className={styles.terminalDim}>$</span>
            <span className={styles.terminalCursor} />
          </span>
        </div>
      </div>
    </aside>
  );
}

function MockTaskbar(): ReactNode {
  const [clockLabel] = useState(() => formatClock(new Date()));
  return (
    <div className={styles.taskbar}>
      <div className={styles.leadCluster}>
        <div className={styles.taskbarContainer}>
          <div className={styles.desktopBubble}>
            <TaskbarIconButton
              icon={<LayoutGrid size={17} strokeWidth={1.5} />}
              aria-label="Desktop"
              tabIndex={-1}
            />
          </div>
        </div>
        <div className={styles.taskbarContainer}>
          <div className={styles.left}>
            <ProfilePill name="Ada Lovelace" plan="pro" onOpenSettings={noop} />
            <Avatar type="team" size={20} name="The Grid" />
            <span className={styles.divider} />
            <span className={styles.favorites}>
              {FAVORITE_AGENTS.map((agent) => (
                <Avatar
                  key={agent.id}
                  type="agent"
                  size={20}
                  name={agent.name}
                  status={agent.status}
                  busy={agent.status === "working"}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.taskbarCenterSlot}>
        <div className={styles.taskbarContainer}>
          <div className={styles.center}>
            {APP_RAIL.map((app) => (
              <TaskbarIconButton
                key={app.id}
                icon={app.icon}
                aria-label={app.title}
                selected={app.active}
                tabIndex={-1}
              />
            ))}
            <span className={styles.divider} />
            <TaskbarIconButton
              icon={<LayoutGrid size={17} strokeWidth={1.5} />}
              aria-label="Apps"
              tabIndex={-1}
            />
            <TaskbarIconButton
              icon={<ChevronRight size={17} strokeWidth={1.5} />}
              aria-label="Collapse"
              tabIndex={-1}
            />
          </div>
        </div>
      </div>

      <div className={styles.taskbarContainer}>
        <div className={styles.right}>
          <div className={styles.rightPrimary}>
            <TaskbarIconButton
              icon={<CreditCard size={17} strokeWidth={1.5} />}
              aria-label="Credits"
              tabIndex={-1}
            />
            <TaskbarIconButton
              icon={<Settings size={17} strokeWidth={1.5} />}
              aria-label="Settings"
              tabIndex={-1}
            />
          </div>
          <span className={styles.clock}>{clockLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function MockAuraDesktop(): ReactNode {
  return (
    <div className={styles.frame} data-testid="mock-aura-desktop">
      <MockTitlebar />
      <div className={styles.body}>
        <img
          className={styles.wallpaper}
          src="/personas/vibecoder/desktop.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
        <MockSidebar />
        <MockExecution />
        <MockSidekick />
      </div>
      <MockTaskbar />
    </div>
  );
}
