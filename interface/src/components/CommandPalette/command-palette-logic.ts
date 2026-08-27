export interface PaletteSearchItem {
  id: string;
  title: string;
  subtitle?: string;
  searchTerms: readonly string[];
  disabled?: boolean;
}

export interface PaletteSearchGroup<TItem extends PaletteSearchItem = PaletteSearchItem> {
  id: string;
  label: string;
  items: readonly TItem[];
}

export function normalizePaletteSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemHaystack(item: PaletteSearchItem): string {
  return normalizePaletteSearch(
    [item.title, item.subtitle ?? "", ...item.searchTerms].join(" "),
  );
}

function matchScore(item: PaletteSearchItem, query: string): number {
  const normalizedTitle = normalizePaletteSearch(item.title);
  const normalizedSubtitle = normalizePaletteSearch(item.subtitle ?? "");
  const normalizedTerms = item.searchTerms.map(normalizePaletteSearch);
  const haystack = itemHaystack(item);
  const queryTokens = query.split(" ").filter(Boolean);

  if (!queryTokens.every((token) => haystack.includes(token))) {
    return Number.NEGATIVE_INFINITY;
  }

  if (normalizedTitle === query) return 500;
  if (normalizedTitle.startsWith(query)) return 400;
  if (normalizedTitle.includes(query)) return 300;
  if (normalizedSubtitle.startsWith(query)) return 220;
  if (normalizedSubtitle.includes(query)) return 180;

  const matchingTermIndex = normalizedTerms.findIndex((term) =>
    term.includes(query),
  );
  if (matchingTermIndex >= 0) return 140 - matchingTermIndex;

  return 100;
}

/**
 * Filters each result group independently so categories remain visually
 * stable while exact and prefix matches rise within their own category.
 * Prefixing a query with `>` mirrors the action-only affordance used by T3.
 */
export function filterPaletteGroups<TItem extends PaletteSearchItem>(
  groups: readonly PaletteSearchGroup<TItem>[],
  rawQuery: string,
): PaletteSearchGroup<TItem>[] {
  const trimmed = rawQuery.trimStart();
  const actionsOnly = trimmed.startsWith(">");
  const query = normalizePaletteSearch(actionsOnly ? trimmed.slice(1) : trimmed);

  return groups.flatMap((group) => {
    if (actionsOnly && group.id !== "actions") return [];
    if (query.length === 0) {
      return group.items.length > 0 ? [{ ...group, items: [...group.items] }] : [];
    }

    const items = group.items
      .map((item, index) => ({ item, index, score: matchScore(item, query) }))
      .filter((entry) => entry.score !== Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.item);

    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

export function flattenPaletteGroups<TItem extends PaletteSearchItem>(
  groups: readonly PaletteSearchGroup<TItem>[],
): TItem[] {
  return groups.flatMap((group) => group.items);
}

export function nextEnabledPaletteIndex<TItem extends PaletteSearchItem>(
  items: readonly TItem[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) return -1;

  for (let step = 1; step <= items.length; step += 1) {
    const index = (currentIndex + direction * step + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }

  return -1;
}
