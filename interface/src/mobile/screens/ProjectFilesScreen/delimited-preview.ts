export const DELIMITED_PREVIEW_LIMITS = {
  rows: 100,
  columns: 30,
  cellCharacters: 1000,
  inputCharacters: 256 * 1024,
};

/** Read a bounded prefix without splitting quoted records or allocating a full file-sized grid. */
export function parseDelimitedPreview(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  const limits = DELIMITED_PREVIEW_LIMITS;
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let truncated = false;
  let malformed = false;
  let recordStarted = false;
  const endCell = () => {
    // A UTF-16 budget must not leave half of a displayed Unicode character.
    if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
    if (row.length < limits.columns) row.push(value);
    else truncated = true;
    value = "";
    afterQuote = false;
  };
  const append = (character: string) => {
    if (value.length < limits.cellCharacters) value += character;
    else truncated = true;
  };
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end = Math.min(text.length, limits.inputCharacters);
  for (let index = start; index < end; index++) {
    const character = text[index];
    recordStarted = true;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"' && index + 1 < end) {
          append('"');
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else append(character);
      continue;
    }
    if (character === delimiter) {
      endCell();
    } else if (character === "\r" || character === "\n") {
      endCell();
      rows.push(row);
      row = [];
      recordStarted = false;
      if (character === "\r" && text[index + 1] === "\n") index++;
      if (rows.length === limits.rows) return { rows, truncated: truncated || index + 1 < text.length, malformed };
    } else if (character === '"' && value === "" && !afterQuote) {
      quoted = true;
    } else {
      if (afterQuote || character === '"') malformed = true;
      append(character);
    }
  }
  if (end < text.length) truncated = true;
  else {
    if (quoted) malformed = true;
    if (recordStarted) {
      endCell();
      rows.push(row);
    }
  }
  // If the scan budget ended mid-record, leave that incomplete record out.
  return { rows, truncated, malformed };
}
