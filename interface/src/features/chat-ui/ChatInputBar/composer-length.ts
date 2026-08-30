export const MAX_CHAT_PROMPT_CHARACTERS = 120_000;

export function promptCharactersOverLimit(text: string): number {
  return Math.max(0, text.length - MAX_CHAT_PROMPT_CHARACTERS);
}

export function promptLengthError(text: string): string | null {
  const charactersOver = promptCharactersOverLimit(text);
  if (charactersOver === 0) return null;
  const noun = charactersOver === 1 ? "character" : "characters";
  return `Remove ${new Intl.NumberFormat("en-US").format(charactersOver)} ${noun} to send this message.`;
}
