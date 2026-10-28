function cellText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof Element && node.tagName === "BR") return "\n";
  return Array.from(node.childNodes, cellText).join("");
}

/** CSV keeps rendered cell values, including commas, quotes and line breaks. */
export function tableToCsv(table: HTMLTableElement): string {
  return Array.from(table.rows, (row) => Array.from(row.cells, (cell) => {
    const value = cellText(cell);
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",")).join("\r\n");
}

