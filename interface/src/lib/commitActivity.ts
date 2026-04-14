interface CommitActivityEvent {
  postType: string;
  timestamp: string;
  commits: Array<unknown>;
  commitIds?: string[];
}

export function getCommitCount(event: CommitActivityEvent): number {
  if (event.postType !== "push") return 0;
  if (event.commits.length > 0) return event.commits.length;
  return event.commitIds?.length ?? 0;
}

export function buildCommitActivityFromEvents(
  events: CommitActivityEvent[],
): Record<string, number> {
  const activity: Record<string, number> = {};

  for (const event of events) {
    const commitCount = getCommitCount(event);
    if (commitCount === 0) continue;

    const ts = new Date(event.timestamp);
    const dateKey = event.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + commitCount;
  }

  return activity;
}
