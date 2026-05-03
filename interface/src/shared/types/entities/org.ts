export type OrgRole = "owner" | "admin" | "member";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Org {
  org_id: string;
  name: string;
  owner_user_id: string;
  slug?: string;
  description?: string;
  avatar_url?: string;
  billing_email?: string;
  billing: OrgBilling | null;
  created_at: string;
  updated_at: string;
}

export interface OrgIntegration {
  integration_id: string;
  org_id: string;
  name: string;
  provider: string;
  kind: "workspace_connection" | "workspace_integration" | "mcp_server";
  default_model?: string | null;
  provider_config?: Record<string, unknown> | null;
  has_secret: boolean;
  enabled: boolean;
  secret_last4?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  display_name: string;
  role: OrgRole;
  avatar_url?: string;
  credit_budget?: number;
  joined_at: string;
}

export interface OrgInvite {
  invite_id: string;
  org_id: string;
  token: string;
  created_by: string;
  status: InviteStatus;
  accepted_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface OrgBilling {
  billing_email: string | null;
  plan: string;
}
