import {
  KeyRound, StickyNote, Bell, BookOpen, Rss, Speaker, MessageCircle,
  Camera, Monitor, Package, Code, Gamepad2, Moon, Sparkles, CircleDot,
  Image, GitBranch, Search, MapPin, HeartPulse, Mail, MessageSquare,
  ArrowRightLeft, BarChart3, FileText, Unplug, FileEdit, Lock, Mic,
  Mic2, Lightbulb, Brain, ShoppingCart, Eye, Globe, ScrollText, Volume2,
  Wrench, Hash, Music, Music2, AlignLeft, ListTodo, Inbox, CheckSquare,
  TerminalSquare, LayoutDashboard, Film, Phone, CloudSun, Link, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  "1password": KeyRound,
  "apple-notes": StickyNote,
  "apple-reminders": Bell,
  "bear-notes": BookOpen,
  blogwatcher: Rss,
  blucli: Speaker,
  bluebubbles: MessageCircle,
  camsnap: Camera,
  canvas: Monitor,
  clawhub: Package,
  "coding-agent": Code,
  discord: Gamepad2,
  eightctl: Moon,
  gemini: Sparkles,
  "gh-issues": CircleDot,
  gifgrep: Image,
  github: GitBranch,
  gog: Search,
  goplaces: MapPin,
  healthcheck: HeartPulse,
  himalaya: Mail,
  imsg: MessageSquare,
  mcporter: ArrowRightLeft,
  "model-usage": BarChart3,
  "nano-pdf": FileText,
  "node-connect": Unplug,
  notion: FileEdit,
  obsidian: Lock,
  "openai-whisper": Mic,
  "openai-whisper-api": Mic2,
  openhue: Lightbulb,
  oracle: Brain,
  ordercli: ShoppingCart,
  peekaboo: Eye,
  sag: Globe,
  "session-logs": ScrollText,
  "sherpa-onnx-tts": Volume2,
  "skill-creator": Wrench,
  slack: Hash,
  songsee: Music,
  sonoscli: Speaker,
  "spotify-player": Music2,
  summarize: AlignLeft,
  taskflow: ListTodo,
  "taskflow-inbox-triage": Inbox,
  "things-mac": CheckSquare,
  tmux: TerminalSquare,
  trello: LayoutDashboard,
  "video-frames": Film,
  "voice-call": Phone,
  wacli: MessageCircle,
  weather: CloudSun,
  xurl: Link,
};

interface SkillIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function SkillIcon({ name, size = 24, className }: SkillIconProps) {
  const Icon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} className={className} />;
}
