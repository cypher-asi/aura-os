import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Spec } from "../../types";
import { useProjectContext } from "../../stores/project-action-store";

function sortByOrder<T extends { order_index: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order_index - right.order_index);
}

interface MobileSpecsData {
  specs: Spec[];
}

export function useMobileSpecs(projectId: string): MobileSpecsData {
  const ctx = useProjectContext();
  const [specs, setSpecs] = useState<Spec[]>(() => sortByOrder(ctx?.initialSpecs ?? []));

  useEffect(() => {
    let cancelled = false;
    void api.listSpecs(projectId).then((nextSpecs) => {
      if (!cancelled) setSpecs(sortByOrder(nextSpecs));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return { specs };
}
