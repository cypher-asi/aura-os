export function indexBy<T>(items: T[], key: (t: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return map;
}

export function sortByOrderIndex<T extends { order_index: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order_index - b.order_index);
}

export function titleSortKey(title: string): number {
  const m = title.match(/^(\d+)\.(\d+)/);
  if (!m) return Infinity;
  return parseInt(m[1], 10) * 100_000 + parseInt(m[2], 10);
}

/** Mirrors the backend `order_index_from_spec_title` – extracts the leading "NN:" number. */
export function orderIndexFromTitle(title: string): number | undefined {
  const m = title.match(/^\s*(\d+)\s*:/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Sort specs by title prefix number (e.g. "03:" → 3), falling back to order_index. */
export function compareSpecs(a: { title: string; order_index: number }, b: { title: string; order_index: number }): number {
  const oa = orderIndexFromTitle(a.title) ?? a.order_index;
  const ob = orderIndexFromTitle(b.title) ?? b.order_index;
  return oa - ob;
}

export function mergeById<T extends { order_index: number }>(
  local: T[],
  remote: T[],
  idKey: keyof T,
): T[] {
  const map = new Map<unknown, T>();
  for (const item of local) map.set(item[idKey], item);
  for (const item of remote) map.set(item[idKey], item);
  return Array.from(map.values()).sort((a, b) => a.order_index - b.order_index);
}
