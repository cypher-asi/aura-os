import type { Processor } from "unified";
import type { CompileContext } from "mdast-util-from-markdown";

/** Keep separators in prose drive paths without disabling Markdown escapes elsewhere. */
export function remarkWindowsPaths(this: Processor) {
  (this.data().fromMarkdownExtensions ??= []).push({
    exit: {
      characterEscape(this: CompileContext) {
        // Link destinations, labels and titles have their own escape rules.
        const parent = this.stack.at(-1);
        if (!parent || parent.type === "fragment" || !("children" in parent)) return;
        const text = parent.children.at(-1);
        if (text?.type !== "text") return;
        // The compiler has just appended the escaped punctuation. Its prefix
        // must still be inside an absolute drive path (no intervening space).
        const prefix = text.value.slice(0, -1);
        if (/(?:^|[^\w])[a-z]:(?:[\\/]\S*)?$/i.test(prefix)) {
          text.value = `${prefix}\\${text.value.slice(-1)}`;
        }
      },
    },
  });
}
