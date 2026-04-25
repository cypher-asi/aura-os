import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Spec } from "../../shared/types";
import { useProjectActions } from "../../stores/project-action-store";
import { compareSpecs } from "../../utils/collections";

function sortSpecs(items: Spec[]): Spec[] {
  return [...items].sort(compareSpecs);
}

interface MobileSpecsData {
  specs: Spec[];
}

export function useMobileSpecs(projectId: string): MobileSpecsData {
  const ctx = useProjectActions();
  const [specs, setSpecs] = useState<Spec[]>(() => sortSpecs(ctx?.initialSpecs ?? []));

  useEffect(() => {
    let cancelled = false;
    void api.listSpecs(projectId).then((nextSpecs) => {
      if (!cancelled) setSpecs(sortSpecs(nextSpecs));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return { specs };
}
