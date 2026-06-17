export interface EnvironmentInfo {
  os: string;
  architecture: string;
  hostname: string;
  ip: string;
  cwd: string;
}

/** A single VM/platform log entry from the swarm gateway. */
export interface RemoteVmLogEntry {
  /** RFC3339 timestamp of the log line. */
  timestamp: string
  /** Raw log line. */
  line: string
  /** "live" = running pod stdout; "snapshot" = final tail captured on a previous pod's termination. */
  source: "live" | "snapshot"
}

export interface RemoteVmLogs {
  /** Merged live-tail + snapshot entries, oldest first. */
  logs: RemoteVmLogEntry[]
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
  /** AWS instance type backing a confidential pod VM (e.g. "m6a.xlarge"). */
  vm_instance_type?: string
  runtime_version?: string
  /** Git commit of the deployed harness build, reported by the swarm gateway. */
  harness_git_sha?: string
  isolation?: string
  endpoint?: string
  created_at?: string
}
