// ---------------------------------------------------------------------------
// Harness skill entities
// ---------------------------------------------------------------------------

export interface HarnessSkill {
  name: string;
  description: string;
  source: string;
  model_invocable: boolean;
  user_invocable: boolean;
  body?: string;
  supporting_files?: string[];
  frontmatter: Record<string, any>;
}

export interface HarnessSkillActivation {
  rendered_content: string;
  allowed_tools: string[];
  fork_context: boolean;
}

export interface HarnessSkillInstallation {
  agent_id: string;
  skill_name: string;
  source_url: string | null;
  installed_at: string;
  version: string | null;
  approved_paths: string[];
  approved_commands: string[];
}

// ---------------------------------------------------------------------------
// Skill Shop catalog
// ---------------------------------------------------------------------------

export type SkillCategory =
  | "development"
  | "communication"
  | "productivity"
  | "media"
  | "ai-ml"
  | "smart-home"
  | "security"
  | "notes"
  | "automation"
  | "utilities";

export type SkillOS = "any" | "windows" | "mac" | "linux";

export interface SkillShopCatalogEntry {
  name: string;
  description: string;
  category: SkillCategory;
  os: SkillOS;
  tags: string[];
  security_rating: "safe" | "caution" | "warning";
  security_notes: string;
  source_url: string;
  requires?: { bins?: string[]; env?: string[]; config?: string[]; anyBins?: string[] };
  install_methods?: { kind: string; formula?: string; package?: string }[];
  permissions?: { paths?: string[]; commands?: string[]; tools?: string[] };
}
