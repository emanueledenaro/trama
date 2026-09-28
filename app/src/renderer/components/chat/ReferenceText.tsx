import { plainText } from "@shared/plainLanguage";
import { lookupReference, type Reference, type ReferenceIndex, referenceText, referenceTitle, splitReferences } from "@shared/references";
import { unknownReferenceTitle } from "@/lib/remarkReferences";
import { openReference, useRecord, useReferenceIndex } from "@/lib/references";

export function ReferenceButton({ reference, children }: { reference: Reference; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="chat-reference"
      title={referenceTitle(reference)}
      data-reference={reference.target.kind}
      data-reference-id={reference.id}
      onClick={(event) => {
        event.stopPropagation();
        openReference(reference.target);
      }}
    >
      {children}
    </button>
  );
}

/** A stretch of plain text with its references as buttons; `before` is what the text wrote just before it. */
function linked(text: string, index: ReferenceIndex, before: string, key: string): { nodes: React.ReactNode[]; written: string } {
  let written = before;
  const nodes = splitReferences(text, index).map((part, position) => {
    const previous = written;
    written += part.text;
    if ("reference" in part) {
      return (
        <ReferenceButton key={`${key}-${position}`} reference={part.reference}>
          {referenceText(part.reference, part.text, previous)}
        </ReferenceButton>
      );
    }
    if ("unknown" in part) {
      return (
        <span key={`${key}-${position}`} data-reference-unknown={part.unknown} title={unknownReferenceTitle(part.unknown)}>
          {part.text}
        </span>
      );
    }
    return part.text;
  });
  return { nodes, written };
}

/**
 * A plain text, not Markdown, with its references as links that open inside Trama (issue #277): for activity
 * details and notices, where ChatMarkdown's blocks do not belong. The text reads plain (issue #270): a stretch in
 * backticks shows as code, or as the name of what it cites, never with the backticks.
 */
export function ReferenceText({ text }: { text: string }) {
  const index = useReferenceIndex();
  const stretches = plainText(text).split(/`([^`\n]+)`/);
  if (!index) return <>{stretches.map((stretch, position) => (position % 2 ? <code key={position} className="plain-code">{stretch}</code> : stretch))}</>;
  let before = "";
  return (
    <>
      {stretches.flatMap<React.ReactNode>((stretch, position) => {
        if (position % 2 === 0) {
          const { nodes, written } = linked(stretch, index, before, String(position));
          before = written;
          return nodes;
        }
        before += stretch;
        const reference = lookupReference(stretch, index);
        const kind = reference?.target.kind;
        if (reference && kind !== "file" && kind !== "branch" && kind !== "commit" && kind !== "module") {
          return [
            <ReferenceButton key={position} reference={reference}>
              {reference.label}
            </ReferenceButton>,
          ];
        }
        const code = <code key={position} className="plain-code">{stretch}</code>;
        return [reference ? <ReferenceButton key={position} reference={reference}>{code}</ReferenceButton> : code];
      })}
    </>
  );
}

/**
 * A record by its name, as a link that opens it, with the id on hover (issue #270): "incarico di Ada, fetta 2, ...".
 * `short` drops the noun for a text that already wrote it. An id that names nothing shows as written.
 */
/** A record's name as plain text, for a place that is already a button; the id on hover (issue #270). */
export function RecordLabel({ id, short = false }: { id: string; short?: boolean }) {
  const reference = useRecord(id);
  return <span title={id}>{reference ? (short ? reference.short : reference.label) : id}</span>;
}

export function RecordName({ id, short = false }: { id: string; short?: boolean }) {
  const reference = useRecord(id);
  if (!reference) return <span className="font-mono text-[0.92em]">{id}</span>;
  return <ReferenceButton reference={reference}>{short ? reference.short : reference.label}</ReferenceButton>;
}
