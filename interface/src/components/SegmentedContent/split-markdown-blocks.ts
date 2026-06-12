/**
 * Split markdown into independently renderable blocks at blank lines,
 * keeping code fences intact. During streaming only the trailing block
 * ever changes, so every earlier block's memoized renderer bails and
 * the remark/rehype pipeline runs over a single paragraph per frame
 * instead of the whole message. (See `SegmentedContent.tsx`.)
 */
export function splitMarkdownBlocks(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fenceOpen = false;
  let fenceChar = "";
  let fenceLen = 0;

  const closeBlock = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      const len = fenceMatch[1].length;
      if (!fenceOpen) {
        fenceOpen = true;
        fenceChar = ch;
        fenceLen = len;
      } else if (ch === fenceChar && len >= fenceLen) {
        fenceOpen = false;
      }
      current.push(line);
      continue;
    }
    if (!fenceOpen && line.trim() === "") {
      closeBlock();
      continue;
    }
    current.push(line);
  }
  closeBlock();
  return blocks;
}
