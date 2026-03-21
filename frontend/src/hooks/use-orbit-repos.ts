import { useState, useEffect, useCallback } from "react";
import { api, type OrbitRepo } from "../api/client";
import type { OrbitRepoMode } from "./use-new-project-form";

interface UseOrbitReposResult {
  orbitRepos: OrbitRepo[];
  orbitReposLoading: boolean;
  resetOrbitRepos: () => void;
}

export function useOrbitRepos(
  isOpen: boolean,
  orbitRepoMode: OrbitRepoMode,
  isAuthenticated: boolean,
): UseOrbitReposResult {
  const [orbitRepos, setOrbitRepos] = useState<OrbitRepo[]>([]);
  const [orbitReposLoading, setOrbitReposLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || orbitRepoMode !== "existing" || !isAuthenticated) return;
    setOrbitReposLoading(true);
    api
      .listOrbitRepos()
      .then(setOrbitRepos)
      .catch(() => setOrbitRepos([]))
      .finally(() => setOrbitReposLoading(false));
  }, [isOpen, orbitRepoMode, isAuthenticated]);

  const resetOrbitRepos = useCallback(() => {
    setOrbitRepos([]);
    setOrbitReposLoading(false);
  }, []);

  return { orbitRepos, orbitReposLoading, resetOrbitRepos };
}
