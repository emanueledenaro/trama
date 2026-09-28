import { referenceText, referenceTitle, splitReferences } from "@shared/references";
import { unknownReferenceTitle } from "@/lib/remarkReferences";
import { openReference, useReferenceIndex } from "@/lib/references";

/**
 * A plain text, not Markdown, with its references as links that open inside Trama (issue #277): for activity
 * details and notices, where ChatMarkdown's blocks do not belong.
 */
export function ReferenceText({ text }: { text: string }) {
  const index = useReferenceIndex();
  if (!index) return <>{text}</>;
  let before = "";
  return (
    <>
      {splitReferences(text, index).map((part, position) => {
        const previous = before;
        before += part.text;
        if ("reference" in part) {
          const { reference } = part;
          return (
            <button
              key={position}
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
              {referenceText(reference, part.text, previous)}
            </button>
          );
        }
        if ("unknown" in part) {
          return (
            <span key={position} data-reference-unknown={part.unknown} title={unknownReferenceTitle(part.unknown)}>
              {part.text}
            </span>
          );
        }
        return part.text;
      })}
    </>
  );
}
