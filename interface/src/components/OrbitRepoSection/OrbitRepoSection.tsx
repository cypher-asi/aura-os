import { useMemo } from "react";
import { Input, Spinner, Text } from "@cypher-asi/zui";
import type { OrbitRepo } from "../../api/client";
import type { OrbitRepoMode } from "../../hooks/use-new-project-form";
import { Select } from "../Select";
import styles from "./OrbitRepoSection.module.css";

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
  const repoOptions = useMemo(
    () => orbitRepos.map((repo) => ({
      value: `${repo.owner}/${repo.name}`,
      label: `${repo.owner}/${repo.name}`,
    })),
    [orbitRepos],
  );

  return (
    <div className={styles.container}>
      <Text variant="muted" size="sm" className={styles.topMargin}>
        Orbit repo
      </Text>
      {!isAuthenticated ? (
        <Text variant="muted" size="sm" className={styles.warningText}>
          Sign in to create a new repo or choose an existing one.
        </Text>
      ) : !orbitOwner ? (
        <Text variant="muted" size="sm" className={styles.warningText}>
          No team found. Sign out and back in to create a default team.
        </Text>
      ) : (
        <>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              checked={orbitRepoMode === "default"}
              onChange={() => setOrbitRepoMode("default")}
            />
            <span>Create new repo with default name</span>
          </label>
          {orbitRepoMode === "default" && (
            <div className={styles.indentedBlock}>
              <Text variant="muted" size="sm">
                orbit/{orbitOwner}/{proposedRepoSlug}
              </Text>
              <Text variant="muted" size="xs" className={styles.hintText}>
                Format: orbit/UUID/name
              </Text>
            </div>
          )}

          <label className={styles.radioLabel}>
            <input
              type="radio"
              checked={orbitRepoMode === "custom"}
              onChange={() => setOrbitRepoMode("custom")}
            />
            <span>Create new repo with custom name</span>
          </label>
          {orbitRepoMode === "custom" && (
            <div className={styles.indentedBlock}>
              <Text variant="muted" size="sm">
                orbit/{orbitOwner}/{displayRepoName}
              </Text>
              <Text variant="muted" size="xs" className={styles.hintText}>
                Format: orbit/UUID/name
              </Text>
              <Input
                value={orbitRepoName}
                onChange={(e) => setOrbitRepoName(e.target.value)}
                placeholder={`Repo name (default: ${proposedRepoSlug})`}
                className={styles.inputTopMargin}
              />
            </div>
          )}

          <label className={styles.radioLabel}>
            <input
              type="radio"
              checked={orbitRepoMode === "existing"}
              onChange={() => setOrbitRepoMode("existing")}
            />
            <span>Use existing repo</span>
          </label>
          {orbitRepoMode === "existing" && (
            <div className={styles.indentedBlock}>
              {orbitReposLoading ? (
                <Spinner size="sm" />
              ) : orbitRepos.length === 0 ? (
                <Text variant="muted" size="sm">
                  No repos found. Create a new repo instead or check Orbit configuration.
                </Text>
              ) : (
                <div className={styles.repoListColumn}>
                  <Text variant="muted" size="sm">
                    Select a repo to link:
                  </Text>
                  <Select
                    value={selectedOrbitRepo ? `${selectedOrbitRepo.owner}/${selectedOrbitRepo.name}` : ""}
                    onChange={(v) => {
                      const repo = orbitRepos.find(
                        (candidate) => `${candidate.owner}/${candidate.name}` === v,
                      );
                      setSelectedOrbitRepo(repo ?? null);
                    }}
                    className={styles.selectInput}
                    placeholder="Select repo"
                    options={repoOptions}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
