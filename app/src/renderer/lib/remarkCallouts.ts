import type { Blockquote, Root } from "mdast";
import { visit } from "unist-util-visit";

/** Callout kinds the AI may open a blockquote with (`> [!DECISION]`), with the label the chat shows. */
export const CALLOUTS = {
  decision: "Decisione",
  blocked: "Bloccato",
  warning: "Attenzione",
  important: "Importante",
  note: "Nota",
  tip: "Suggerimento",
  caution: "Rischio",
} as const;

export type CalloutKind = keyof typeof CALLOUTS;

const MARKER = /^\[!([A-Za-z]+)\][ \t]*(?:\r?\n)?/;

/**
 * Turns GitHub-style alerts (`> [!WARNING]`) into callout blocks: the marker is removed and the
 * blockquote gets `chat-callout chat-callout--<kind>` with its label. Unknown markers stay plain quotes.
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const text = first.children[0];
      if (text?.type !== "text") return;
      const match = MARKER.exec(text.value);
      const kind = match?.[1]!.toLowerCase();
      if (!match || !kind || !(kind in CALLOUTS)) return;
      text.value = text.value.slice(match[0].length);
      if (!text.value) first.children.shift();
      // A marker alone on its line leaves a leading break before the body.
      if (first.children[0]?.type === "break") first.children.shift();
      if (!first.children.length) node.children.shift();
      node.data = {
        ...node.data,
        hProperties: { className: ["chat-callout", `chat-callout--${kind}`], "data-kind": kind, "data-label": CALLOUTS[kind as CalloutKind] },
      };
    });
  };
}
