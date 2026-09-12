export type SettingsDestination = "profile" | "feed" | "leaderboard" | "feedback" | "team" | "host";

export function getSettingsDestinationTitle(destination: SettingsDestination) {
  if (destination === "profile") return "Profile";
  if (destination === "leaderboard") return "Leaderboard";
  if (destination === "feedback") return "Feedback";
  if (destination === "team") return "Team settings";
  if (destination === "host") return "Host settings";
  return "Feed";
}
