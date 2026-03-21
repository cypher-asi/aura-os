import { Input, Spinner, Text } from "@cypher-asi/zui";
import type { OrbitRepo } from "../api/client";
import type { OrbitRepoMode } from "../hooks/use-new-project-form";

export function OrbitRepoSection({
  isAuthenticated,
  orbitOwner,
  orbitRepoMode,
  setOrbitRepoMode,
  orbitRepoName,
  setOrbitRepoName,
  proposedRepoSlug,
  displayRepoName,
  orbitRepos,
  orbitReposLoading,
  selectedOrbitRepo,
  setSelectedOrbitRepo,
}: {
  isAuthenticated: boolean;
  orbitOwner: string | null;
  orbitRepoMode: OrbitRepoMode;
  setOrbitRepoMode: (mode: OrbitRepoMode) => void;
  orbitRepoName: string;
  setOrbitRepoName: (name: string) => void;
  proposedRepoSlug: string;
  displayRepoName: string;
  orbitRepos: OrbitRepo[];
  orbitReposLoading: boolean;
  selectedOrbitRepo: OrbitRepo | null;
  setSelectedOrbitRepo: (repo: OrbitRepo | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Text variant="muted" size="sm" style={{ marginTop: "var(--space-2)" }}>
        Orbit repo
      </Text>
      {!isAuthenticated ? (
        <Text variant="muted" size="sm" style={{ color: "var(--color-warning)" }}>
          Sign in to create a new repo or choose an existing one.
        </Text>
      ) : !orbitOwner ? (
        <Text variant="muted" size="sm" style={{ color: "var(--color-warning)" }}>
          No team found. Sign out and back in to create a default team.
        </Text>
      ) : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input
              type="radio"
              checked={orbitRepoMode === "default"}
              onChange={() => setOrbitRepoMode("default")}
            />
            <span>Create new repo with default name</span>
          </label>
          {orbitRepoMode === "default" && (
            <div style={{ paddingLeft: "var(--space-6)" }}>
              <Text variant="muted" size="sm">
                orbit/{orbitOwner}/{proposedRepoSlug}
              </Text>
              <Text variant="muted" size="xs" style={{ opacity: 0.85, marginTop: "var(--space-1)" }}>
                Format: orbit/UUID/name
              </Text>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input
              type="radio"
              checked={orbitRepoMode === "custom"}
              onChange={() => setOrbitRepoMode("custom")}
            />
            <span>Create new repo with custom name</span>
          </label>
          {orbitRepoMode === "custom" && (
            <div style={{ paddingLeft: "var(--space-6)" }}>
              <Text variant="muted" size="sm">
                orbit/{orbitOwner}/{displayRepoName}
              </Text>
              <Text variant="muted" size="xs" style={{ opacity: 0.85, marginTop: "var(--space-1)" }}>
                Format: orbit/UUID/name
              </Text>
              <Input
                value={orbitRepoName}
                onChange={(e) => setOrbitRepoName(e.target.value)}
                placeholder={`Repo name (default: ${proposedRepoSlug})`}
                style={{ marginTop: "var(--space-1)" }}
              />
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}>
            <input
              type="radio"
              checked={orbitRepoMode === "existing"}
              onChange={() => setOrbitRepoMode("existing")}
            />
            <span>Use existing repo</span>
          </label>
          {orbitRepoMode === "existing" && (
            <div style={{ paddingLeft: "var(--space-6)" }}>
              {orbitReposLoading ? (
                <Spinner size="sm" />
              ) : orbitRepos.length === 0 ? (
                <Text variant="muted" size="sm">
                  No repos found. Create a new repo instead or check Orbit configuration.
                </Text>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                  <Text variant="muted" size="sm">
                    Select a repo to link:
                  </Text>
                  <select
                    value={selectedOrbitRepo ? `${selectedOrbitRepo.owner}/${selectedOrbitRepo.name}` : ""}
                    onChange={(e) => {
                      const repo = orbitRepos.find(
                        (candidate) => `${candidate.owner}/${candidate.name}` === e.target.value,
                      );
                      setSelectedOrbitRepo(repo ?? null);
                    }}
                    style={{
                      padding: "var(--space-2)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <option value="">— Select repo —</option>
                    {orbitRepos.map((repo) => (
                      <option key={`${repo.owner}/${repo.name}`} value={`${repo.owner}/${repo.name}`}>
                        {repo.owner}/{repo.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
