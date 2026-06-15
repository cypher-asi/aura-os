// interface/src/lib/analytics-registry.ts
// Canonical inventory of client analytics events. Do NOT re-derive via
// grep/search — dynamic-import call sites make string search unreliable; the
// contract test enforces this set against the actual call sites instead.
// 45 client events; session_active is server-only and deliberately absent.
export const ANALYTICS_EVENTS = {
  // lifecycle / auth
  app_opened: {}, // main.tsx:76
  user_logged_in: {}, // auth-store.ts:222
  user_signed_up: { props: ["has_invite_code"] }, // auth-store.ts:238
  // chat
  chat_message_sent: { props: ["model", "mode"] }, // ChatInputBar.tsx:804
  chat_new_chat: {}, // use-fresh-canvas.ts:145
  model_selected: { props: ["model_name", "effort"] }, // chat-ui-store.ts:458
  mode_selected: { props: ["mode"] }, // chat-ui-store.ts:598
  file_attached: { props: ["file_count"] }, // useFileAttachments.ts:244,334
  // projects / tasks / process
  project_created: { props: ["environment"] }, // use-new-project-form.ts:196
  project_opened: {}, // project-list-projects-explorer.tsx:297 (dyn)
  task_created: {}, // AddTaskForm.tsx:115
  task_run_started: { props: ["model"] }, // RunTaskButton.tsx:45
  process_created: {}, // ProcessForm.tsx:47
  process_triggered: {}, // ProcessMainPanel.tsx:48
  note_created: {}, // NotesNav.tsx:341 (dyn)
  // agents / marketplace / 3D
  agent_created: {}, // useAgentEditorForm.ts:435
  agent_selected: {}, // agent-store.ts:395
  marketplace_agent_hired: {}, // HireProjectPickerModal.tsx:62
  aura3d_image_generated: { props: ["model"] }, // ImageGeneration.tsx:140
  aura3d_model_generated: {}, // ModelGeneration.tsx:208
  // integrations / settings / feedback
  integration_connected: { props: ["provider"] }, // IntegrationEditor.tsx:170,207
  settings_opened: {}, // OrgSettingsPanel.tsx:205
  invite_code_copied: {}, // InviteModal.tsx:38 / OrgSettingsRewards.tsx:32 (source optional)
  feedback_created: { props: ["category", "product"] }, // NewFeedbackModal.tsx:165
  bug_report_created: { props: ["severity"] }, // BugReportConsentModal.tsx:120
  // billing
  tier_modal_opened: {}, // TierSubscriptionModal.tsx:94
  subscription_checkout_started: { props: ["plan"] }, // TierSubscriptionModal.tsx:107
  credits_checkout_started: { props: ["amount_usd"] }, // BuyCreditsModal.tsx:56
  // onboarding
  onboarding_started: {}, // WelcomeModal.tsx:61
  onboarding_welcome_completed: {}, // WelcomeModal.tsx:71
  onboarding_welcome_skipped: { props: ["at_step"] }, // WelcomeModal.tsx:77
  onboarding_task_clicked: { props: ["task_id"] }, // OnboardingChecklist.tsx:36
  onboarding_task_completed: { props: ["task_id", "progress"] }, // useOnboardingTaskWatcher.ts:42+
  onboarding_completed: {},
  onboarding_checklist_dismissed: { props: ["tasks_completed"] },
  onboarding_reopened: {}, // use-menu-actions.ts:225
  onboarding_agent_configured: {}, // useApplyAgentOnboarding.ts:42
  // public / marketing
  public_page_viewed: {}, // use-public-shell-analytics.ts:18
  public_gate_shown: {}, // use-public-shell-analytics.ts:37
  public_session_started: {}, // public-chat-store.ts:268
  public_message_sent: { props: ["mode"] },
  public_login_clicked: { props: ["source"] },
  public_signup_clicked: { props: ["source"] },
  public_download_clicked: { props: ["source"] },
  public_create_agent_clicked: { props: ["source"] },
} as const satisfies Record<string, { props?: readonly string[] }>;
// 45 entries — the complete client analytics event set.

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const ENGAGED_BUNDLE = [
  "chat_message_sent",
  "task_created",
  "task_run_started",
  "project_created",
  "agent_created",
  "process_triggered",
  "note_created",
  "aura3d_image_generated",
  "aura3d_model_generated",
  "marketplace_agent_hired",
] as const satisfies readonly AnalyticsEventName[];

// Server events listed for the cross-language check (not used by TS emit):
export const SERVER_EVENTS = [
  "session_active",
  "share_link_generated",
  "share_link_opened",
] as const;
