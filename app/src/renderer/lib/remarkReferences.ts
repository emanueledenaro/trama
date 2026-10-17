import type { InlineCode, Link, PhrasingContent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { translator, type Translate } from "@shared/i18n";
import { plainText } from "@shared/plainLanguage";
import {
  lookupReference,
  type Reference,
  type ReferenceIndex,
  referenceHref,
  referenceText,
  referenceTitle,
  splitReferences,
  unknownReferenceText,
  unknownReferenceTitle,
} from "@shared/references";
import { currentLanguage } from "@/lib/i18n";

function link(reference: Reference, children: PhrasingContent[]): Link {
  return {
    type: "link",
    url: referenceHref(reference.target),
    title: referenceTitle(reference),
    children,
    data: { hProperties: { "data-reference": reference.target.kind, "data-reference-id": reference.id } },
  };
}

/** An id that names nothing: the text reads "non più disponibile", and the id stays in the data and on hover. */
function unknown(value: string): Text {
  const t = translator(currentLanguage());
  return {
    type: "text",
    value: unknownReferenceText(t),
    data: { hName: "span", hProperties: { "data-reference-unknown": value, title: unknownReferenceTitle(t, value) }, hChildren: [{ type: "text", value: unknownReferenceText(t) }] },
  };
}

/**
 * Turns the references a message cites into links that open inside Trama (issue #277): ids and numbers show their
 * readable name and keep the id on hover; paths, branches and commits keep what was written. Text already inside
 * a link stays as it is.
 */
export function remarkReferences(options: { index: ReferenceIndex | null }) {
  const index = options.index;
  return (tree: Root) => {
    if (!index) return;
    visit(tree, (node, position, parent) => {
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "html") return SKIP;
      if (!parent || position === undefined) return;
      if (node.type === "inlineCode") {
        const reference = lookupReference((node as InlineCode).value, index);
        if (!reference) return;
        const kind = reference.target.kind;
        // A path, a branch or a commit reads as code; an id reads as its name.
        const keepCode = kind === "file" || kind === "branch" || kind === "commit" || kind === "module";
        const children: PhrasingContent[] = keepCode ? [node as InlineCode] : [{ type: "text", value: reference.label }];
        parent.children.splice(position, 1, link(reference, children));
        return [SKIP, position + 1];
      }
      if (node.type !== "text") return;
      const parts = splitReferences((node as Text).value, index);
      if (parts.length === 1 && !("reference" in parts[0]!) && !("unknown" in parts[0]!)) return;
      let before = "";
      const nodes: PhrasingContent[] = parts.map((part) => {
        const previous = before;
        before += part.text;
        if ("reference" in part) return link(part.reference, [{ type: "text", value: referenceText(part.reference, part.text, previous) }]);
        if ("unknown" in part) return unknown(part.text);
        return { type: "text", value: part.text };
      });
      parent.children.splice(position, 1, ...(nodes as typeof parent.children));
      return [SKIP, position + nodes.length];
    });
  };
}

/**
 * Makes an agent's or Trama's words plain for the person (issue #270): a skill cited with its path shows its name,
 * technical codes read in the interface language. Code, inline code and links stay as written.
 */
export function remarkPlainText(options: { t: Translate }) {
  const t = options.t;
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode" || node.type === "html") return SKIP;
      if (node.type === "text") (node as Text).value = plainText(t, (node as Text).value);
    });
  };
}
