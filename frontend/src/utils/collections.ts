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
