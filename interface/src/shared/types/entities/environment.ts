export interface EnvironmentInfo {
  os: string;
  architecture: string;
  hostname: string;
  ip: string;
  cwd: string;
}

export interface RemoteVmState {
  state: string
  uptime_seconds: number
  active_sessions: number
  last_heartbeat_at?: string
  error_message?: string
  agent_id?: string
  name?: string
  cpu_millicores?: number
  memory_mb?: number
  runtime_version?: string
  /** Git commit of the deployed harness build, reported by the swarm gateway. */
  harness_git_sha?: string
  isolation?: string
  endpoint?: string
  created_at?: string
}
