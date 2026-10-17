/** Session-memory only: no transcript text or browser-persistent user data. */
export interface ChatReadingPosition {
  rowId: string;
  offsetWithinRow: number;
  scrollOffset: number;
  atEnd: boolean;
}

const positions = new Map<string, ChatReadingPosition>();
const MAX_POSITIONS = 100;

export function readChatPosition(key?: string): ChatReadingPosition | undefined {
  return key ? positions.get(key) : undefined;
}

export function rememberChatPosition(key: string, position: ChatReadingPosition): void {
  positions.delete(key);
  positions.set(key, { ...position });
  if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value!);
}

export function followChatPosition(key?: string): void {
  const position = readChatPosition(key);
  if (key && position) rememberChatPosition(key, { ...position, atEnd: true });
}

export function clearChatPositions(): void {
  positions.clear();
}
