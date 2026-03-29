export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  category: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Core
  { id: "read_file", label: "Read File", description: "Read file contents", category: "Core" },
  { id: "write_file", label: "Write File", description: "Create or overwrite a file", category: "Core" },
  { id: "edit_file", label: "Edit File", description: "Make targeted edits to a file", category: "Core" },
  { id: "search_code", label: "Search Code", description: "Search for patterns across files", category: "Core" },
  { id: "find_files", label: "Find Files", description: "Find files by name or glob", category: "Core" },
  { id: "list_files", label: "List Files", description: "List files in a directory", category: "Core" },
  { id: "run_command", label: "Run Command", description: "Execute a shell command", category: "Core" },
  { id: "stat_file", label: "File Info", description: "Get file metadata and permissions", category: "Core" },
  { id: "delete_file", label: "Delete File", description: "Delete a file", category: "Core" },

  // Specs
  { id: "list_specs", label: "List Specs", description: "List all project specs", category: "Specs" },
  { id: "get_spec", label: "Get Spec", description: "Get a spec by ID", category: "Specs" },
  { id: "create_spec", label: "Create Spec", description: "Create a new spec", category: "Specs" },
  { id: "update_spec", label: "Update Spec", description: "Update an existing spec", category: "Specs" },
  { id: "delete_spec", label: "Delete Spec", description: "Delete a spec and its tasks", category: "Specs" },

  // Tasks
  { id: "list_tasks", label: "List Tasks", description: "List all project tasks", category: "Tasks" },
  { id: "create_task", label: "Create Task", description: "Create a task under a spec", category: "Tasks" },
  { id: "update_task", label: "Update Task", description: "Update a task", category: "Tasks" },
  { id: "delete_task", label: "Delete Task", description: "Delete a task", category: "Tasks" },
  { id: "transition_task", label: "Transition Task", description: "Change task status", category: "Tasks" },
  { id: "run_task", label: "Run Task", description: "Execute a task via the engine", category: "Tasks" },

  // Git / Orbit
  { id: "orbit_push", label: "Git Push", description: "Push a branch to orbit", category: "Git" },
  { id: "orbit_create_repo", label: "Create Repo", description: "Create a new orbit repository", category: "Git" },
  { id: "orbit_list_repos", label: "List Repos", description: "List orbit repositories", category: "Git" },
  { id: "orbit_list_branches", label: "List Branches", description: "List branches in a repo", category: "Git" },
  { id: "orbit_create_branch", label: "Create Branch", description: "Create a branch", category: "Git" },
  { id: "orbit_list_commits", label: "List Commits", description: "List recent commits", category: "Git" },
  { id: "orbit_get_diff", label: "Get Diff", description: "Get diff for a commit", category: "Git" },
  { id: "orbit_create_pr", label: "Create PR", description: "Open a pull request", category: "Git" },
  { id: "orbit_list_prs", label: "List PRs", description: "List pull requests", category: "Git" },
  { id: "orbit_merge_pr", label: "Merge PR", description: "Merge a pull request", category: "Git" },

  // Project
  { id: "get_project", label: "Get Project", description: "Get project details", category: "Project" },
  { id: "update_project", label: "Update Project", description: "Update project settings", category: "Project" },
  { id: "list_projects", label: "List Projects", description: "List organization projects", category: "Project" },

  // Dev Loop
  { id: "start_dev_loop", label: "Start Dev Loop", description: "Start autonomous development", category: "Dev Loop" },
  { id: "pause_dev_loop", label: "Pause Dev Loop", description: "Pause the dev loop", category: "Dev Loop" },
  { id: "stop_dev_loop", label: "Stop Dev Loop", description: "Stop the dev loop", category: "Dev Loop" },

  // Network
  { id: "post_to_feed", label: "Post to Feed", description: "Post a status update", category: "Network" },
  { id: "check_budget", label: "Check Budget", description: "Check remaining credits", category: "Network" },
];

const commandIndex = new Map<string, SlashCommand>();
for (const cmd of SLASH_COMMANDS) commandIndex.set(cmd.id, cmd);

export function getCommandById(id: string): SlashCommand | undefined {
  return commandIndex.get(id);
}

export function filterCommands(
  query: string,
  excludeIds: Set<string>,
): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (c) =>
      !excludeIds.has(c.id) &&
      (c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)),
  );
}
