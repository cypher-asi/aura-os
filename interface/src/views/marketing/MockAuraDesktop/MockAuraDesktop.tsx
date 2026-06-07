import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge, Text } from "@cypher-asi/zui";
import {
  ArrowUp,
  Brain,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Cpu,
  CreditCard,
  File,
  FileCode2,
  Folder,
  FolderClosed,
  FolderOpen,
  Globe,
  LayoutGrid,
  MessageSquare,
  Minus,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { ShellTitlebar } from "../../../components/ShellTitlebar";
import { PanelSearch } from "../../../components/PanelSearch";
import { AppSwitchToggle } from "../../../components/AppSwitchToggle";
import { ProfilePill } from "../../../components/BottomTaskbar/ProfilePill";
import { TaskbarIconButton } from "../../../components/AppNavRail/TaskbarIconButton";
import { Avatar } from "../../../components/Avatar";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { SidekickTabBar, type TabItem } from "../../../components/SidekickTabBar";
import { PlayLoopGlyph } from "../../../components/PlayLoopGlyph";
import { CheckLoopGlyph } from "../../../components/CheckLoopGlyph";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { TypingIndicator } from "../../public-chat/TypingIndicator";
import { TerminalStream } from "../../public-chat/TerminalStream";
import {
  EXPLORER_ROWS,
  FAVORITE_AGENTS,
  MOCK_AGENTS,
  MOCK_PROJECTS,
  TASK_ROWS,
  TERMINAL_LINES,
  type MockAgent,
  type MockChatFrame,
} from "./mock-data";
import styles from "./MockAuraDesktop.module.css";

/*
 * MockAuraDesktop — an interactive, app-faithful mock of the
 * authenticated AURA desktop shell (`AuraShell`), used as the stage on
 * the `/code` marketing page. It reproduces the real shell's structure
 * — titlebar, left agents/projects nav, a center LLM chat, a
 * half-width right sidekick, and the bottom taskbar — by REUSING the
 * app's real presentational components (`ShellTitlebar`, `PanelSearch`,
 * `AppSwitchToggle`, `ProfilePill`, `TaskbarIconButton`, `Avatar`,
 * `TaskStatusIcon`, `SidekickTabBar`, the loop glyphs, and the
 * marketing chat primitives) wired to hardcoded mock data and local
 * React state. Nothing here touches a store, socket, router, or API.
 *
 * Pointer-interactive: the visitor can flip the Agents/Projects toggle
 * and pick an agent (which re-plays the center chat). The right
 * sidekick runs on its own scripted loop — the Terminal tab streams
 * mock output, then auto-switches to the Tasks (automation) tab.
 *
 * The whole subtree is `aria-hidden` by its host (`MarketingFirstScreen
 * stageHidden`), so controls stay pointer-only (`tabIndex={-1}` where
 * authored here) and never expose focusable chrome to assistive tech —
 * the page's accessible name is carried by the `PageHero` above it.
 */

const noop = () => undefined;

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion(): boolean {
  // Read synchronously on first render so reduced-motion consumers
  // (chat playback, the scripted sidekick) pick the right initial
  // state without a post-mount flip. The effect only subscribes to
  // later changes — no synchronous setState in the effect body.
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function formatClock(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

/* ---------------------------------------------------------------- */
/* Titlebar                                                         */
/* ---------------------------------------------------------------- */

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

/* ---------------------------------------------------------------- */
/* Left nav — Agents / Projects                                     */
/* ---------------------------------------------------------------- */

interface MockSidebarProps {
  appView: "agents" | "projects";
  onAppViewChange: (view: "agents" | "projects") => void;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

function MockSidebar({
  appView,
  onAppViewChange,
  selectedAgentId,
  onSelectAgent,
}: MockSidebarProps): ReactNode {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <PanelSearch
          placeholder={appView === "agents" ? "Search agents" : "Search projects"}
          value=""
          onChange={noop}
        />
        <AppSwitchToggle
          options={[
            { id: "agents", label: "Agents" },
            { id: "projects", label: "Projects" },
          ]}
          active={appView}
          onChange={(id) => onAppViewChange(id === "projects" ? "projects" : "agents")}
          ariaLabel="Switch between Agents and Projects"
        />
      </div>
      {appView === "agents" ? (
        <div className={styles.agentList}>
          {MOCK_AGENTS.map((agent) => (
            <button
              key={agent.id}
              type="button"
              tabIndex={-1}
              className={`${styles.agentRow} ${
                agent.id === selectedAgentId ? styles.agentRowActive : ""
              }`}
              onClick={() => onSelectAgent(agent.id)}
            >
              <Avatar
                type="agent"
                size={34}
                name={agent.name}
                status={agent.status}
                busy={agent.busy}
                className={styles.agentAvatar}
              />
              <span className={styles.agentBody}>
                <span className={styles.agentTop}>
                  <span className={styles.agentName}>{agent.name}</span>
                  <span className={styles.agentRole}>{agent.role}</span>
                </span>
                <span className={styles.agentPreview}>{agent.preview}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.projectsPane}>
          <div className={styles.projectList}>
            {MOCK_PROJECTS.map((project) => (
              <button
                key={project.id}
                type="button"
                tabIndex={-1}
                className={`${styles.projectRow} ${
                  project.active ? styles.projectRowActive : ""
                }`}
              >
                <FolderOpen size={15} className={styles.treeIcon} />
                <span className={styles.projectBody}>
                  <span className={styles.projectName}>{project.name}</span>
                  <span className={styles.projectSubtitle}>{project.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
          <div className={styles.tree}>
            {EXPLORER_ROWS.map((row, index) => (
              <div
                key={`${row.label}-${index}`}
                className={`${styles.treeRow} ${row.active ? styles.treeRowActive : ""}`}
                style={{ paddingLeft: `${8 + row.depth * 12}px` }}
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
        </div>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- */
/* Center — LLM chat                                                */
/* ---------------------------------------------------------------- */

/** Drives the progressive reveal of an agent's transcript: walks the
 *  frames on a timer, holding the typing indicator for each agent
 *  frame's `typingMs` before revealing it. Mounted keyed per agent so
 *  state resets on selection. Reduced motion reveals everything at
 *  once (the timer effect is skipped entirely). */
function useTranscriptPlayback(
  frames: readonly MockChatFrame[],
  reducedMotion: boolean,
): { revealed: number; typingNext: boolean } {
  const [revealed, setRevealed] = useState(0);
  const [typingNext, setTypingNext] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let index = 0;

    const step = (): void => {
      const frame = frames[index];
      if (!frame) return;
      const reveal = (): void => {
        setTypingNext(false);
        setRevealed(index + 1);
        index += 1;
        if (index < frames.length) {
          timers.push(setTimeout(step, 1100));
        }
      };
      if (frame.from === "agent" && frame.typingMs) {
        setTypingNext(true);
        timers.push(setTimeout(reveal, frame.typingMs));
      } else {
        reveal();
      }
    };

    timers.push(setTimeout(step, 450));
    return () => timers.forEach(clearTimeout);
  }, [frames, reducedMotion]);

  return {
    revealed: reducedMotion ? frames.length : revealed,
    typingNext: reducedMotion ? false : typingNext,
  };
}

function MockChatMessageRow({ frame }: { frame: MockChatFrame }): ReactNode {
  if (frame.from === "user") {
    return (
      <div className={`${styles.msgRow} ${styles.msgRowUser}`}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          {frame.kind === "message" ? frame.text : null}
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.msgRow} ${styles.msgRowAgent}`}>
      {frame.kind === "message" ? (
        <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
          <TypewriterText text={frame.text} />
        </div>
      ) : (
        <div className={styles.toolCard}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName}>{frame.toolName}</span>
            {frame.target ? (
              <span className={styles.toolTarget}>{frame.target}</span>
            ) : null}
          </div>
          <TerminalStream lines={[...frame.preview]} language={frame.language} />
        </div>
      )}
    </div>
  );
}

function MockChat({
  agent,
  reducedMotion,
}: {
  agent: MockAgent;
  reducedMotion: boolean;
}): ReactNode {
  const { revealed, typingNext } = useTranscriptPlayback(
    agent.transcript,
    reducedMotion,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revealed, typingNext]);

  return (
    <main className={styles.main}>
      <div className={styles.chat} style={{ "--agent-accent": agent.accent } as React.CSSProperties}>
        <div className={styles.chatHeader}>
          <Avatar
            type="agent"
            size={28}
            name={agent.name}
            status={agent.status}
            busy={agent.busy}
          />
          <span className={styles.chatHeaderText}>
            <Text size="sm" as="span" weight="medium">
              {agent.name}
            </Text>
            <span className={styles.chatHeaderRole}>{agent.role}</span>
          </span>
          <Badge variant={agent.busy ? "running" : "stopped"} pulse={agent.busy}>
            {agent.busy ? "working" : "idle"}
          </Badge>
        </div>

        <div className={styles.transcript} ref={scrollRef}>
          {agent.transcript.slice(0, revealed).map((frame, index) => (
            <MockChatMessageRow key={`${agent.id}-${index}`} frame={frame} />
          ))}
          {typingNext ? (
            <div className={`${styles.msgRow} ${styles.msgRowAgent}`}>
              <div className={`${styles.bubble} ${styles.bubbleAgent} ${styles.bubbleTyping}`}>
                <TypingIndicator color={agent.accent} />
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.composer}>
          <span className={styles.composerInput}>Message {agent.name}…</span>
          <span className={styles.composerSend}>
            <ArrowUp size={15} strokeWidth={2.25} />
          </span>
        </div>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- */
/* Right sidekick — scripted Terminal -> Tasks loop                 */
/* ---------------------------------------------------------------- */

const SIDEKICK_TABS: readonly TabItem[] = [
  { id: "sessions", icon: <MessageSquare size={16} />, title: "Chats" },
  { id: "terminal", icon: <SquareTerminal size={16} />, title: "Terminal" },
  { id: "browser", icon: <Globe size={16} />, title: "Browser" },
  { id: "specs", icon: <File size={16} />, title: "Plans" },
  { id: "run", icon: <PlayLoopGlyph active={false} size={16} />, title: "Run" },
  { id: "tasks", icon: <CheckLoopGlyph active size={16} />, title: "Tasks" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
  { id: "files", icon: <FolderClosed size={16} />, title: "Files" },
];

function MockSidekick({ reducedMotion }: { reducedMotion: boolean }): ReactNode {
  // Scripted loop: open on the Terminal tab streaming mock output, then
  // auto-switch to the Tasks (automation) tab, hold, and repeat. Under
  // reduced motion we settle straight onto the Tasks tab.
  const [activeTab, setActiveTab] = useState<string>(
    reducedMotion ? "tasks" : "terminal",
  );
  const [streamNonce, setStreamNonce] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = (): void => {
      setActiveTab("terminal");
      setStreamNonce((n) => n + 1);
      timers.push(
        setTimeout(() => setActiveTab("tasks"), 5500),
        setTimeout(cycle, 11000),
      );
    };
    timers.push(setTimeout(cycle, 0));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  return (
    <aside className={styles.sidekick}>
      <div className={styles.sidekickTabs}>
        <SidekickTabBar
          tabs={SIDEKICK_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      <div className={styles.sidekickBody}>
        {activeTab === "terminal" ? (
          <>
            <span className={styles.sidekickTitle}>Terminal · agent vm</span>
            <div className={styles.terminal}>
              <TerminalStream key={streamNonce} lines={[...TERMINAL_LINES]} />
            </div>
          </>
        ) : activeTab === "tasks" ? (
          <>
            <span className={styles.sidekickTitle}>Task automation</span>
            <div className={styles.taskList}>
              {TASK_ROWS.map((task) => (
                <div
                  key={task.title}
                  className={`${styles.taskRow} ${
                    task.status === "in_progress" && !task.child ? styles.taskRowActive : ""
                  }`}
                  style={task.child ? { paddingLeft: 28 } : undefined}
                >
                  <TaskStatusIcon status={task.status} />
                  <span className={styles.taskTitle}>
                    {task.child ? `↳ ${task.title}` : task.title}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.sidekickPlaceholder}>
            <span className={styles.sidekickTitle}>{tabTitle(activeTab)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function tabTitle(id: string): string {
  return SIDEKICK_TABS.find((tab) => tab.id === id)?.title ?? "";
}

/* ---------------------------------------------------------------- */
/* Bottom taskbar                                                   */
/* ---------------------------------------------------------------- */

const APP_RAIL: ReadonlyArray<{ id: string; title: string; icon: ReactNode }> = [
  { id: "agents", title: "Agents", icon: <Brain size={17} strokeWidth={1.5} /> },
  { id: "projects", title: "Projects", icon: <FolderOpen size={17} strokeWidth={1.5} /> },
  { id: "tasks", title: "Tasks", icon: <Check size={17} strokeWidth={1.5} /> },
  { id: "process", title: "Process", icon: <Cpu size={17} strokeWidth={1.5} /> },
];

function MockTaskbar({ appView }: { appView: "agents" | "projects" }): ReactNode {
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
                selected={app.id === appView}
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

/* ---------------------------------------------------------------- */
/* Shell                                                            */
/* ---------------------------------------------------------------- */

export function MockAuraDesktop(): ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  const [appView, setAppView] = useState<"agents" | "projects">("agents");
  const [selectedAgentId, setSelectedAgentId] = useState<string>(MOCK_AGENTS[0].id);

  const selectedAgent = useMemo(
    () => MOCK_AGENTS.find((agent) => agent.id === selectedAgentId) ?? MOCK_AGENTS[0],
    [selectedAgentId],
  );

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
        <MockSidebar
          appView={appView}
          onAppViewChange={setAppView}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
        <MockChat key={selectedAgent.id} agent={selectedAgent} reducedMotion={reducedMotion} />
        <MockSidekick reducedMotion={reducedMotion} />
      </div>
      <MockTaskbar appView={appView} />
    </div>
  );
}
