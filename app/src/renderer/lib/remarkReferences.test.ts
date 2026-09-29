import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import type { Candidate, SpecialistAssignment, Specialist } from "@shared/domain";
import { buildReferenceIndex } from "@shared/references";
import { emptyDocument } from "../../main/core/document";
import { remarkReferences } from "./remarkReferences";
import { translator } from "@shared/i18n";

const t = translator("it");

const document = emptyDocument("p");
document.team.specialists = [
  { id: "S-33333333", name: "Luca", origin: "coordinator", competence: "Swift", assignments: [{ id: "A-11111111", objective: "Ordini in revisione" } as SpecialistAssignment] } as unknown as Specialist,
];
document.candidates = [{ id: "C-55555555", assignmentId: "A-11111111", specialistId: "S-33333333", baseSHA: "0123456789abcdef", technicalReview: null, pullRequest: null } as unknown as Candidate];
const index = buildReferenceIndex(t, {
  document,
  modules: [{ id: "Sources/Orders", name: "Orders", summary: "", relativePath: "Sources/Orders", files: [{ id: "f", relativePath: "Sources/Orders/Cancel.swift", lineCount: 1, contentHash: "" }], dependencies: [], symbol: "folder" }],
  github: { repository: "o/r", status: "ready", message: null, issues: [{ number: 13, title: "Annullo", state: "open", body: "", url: "https://github.com/o/r/issues/13", author: null, labels: [], updatedAt: "" }], snapshot: null, events: [] },
});

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, [remarkReferences, { index }]], urlTransform: (url: string) => (url.startsWith("trama:ref/") ? url : defaultUrlTransform(url)) },
      text,
    ),
  );

describe("remarkReferences (issue #277)", () => {
  it("links the references with their readable name and the id on hover", () => {
    const html = render("Il candidato C-55555555 chiude la #13.");
    expect(html).toContain('<a href="trama:ref/candidate/C-55555555" title="C-55555555: Ordini in revisione" data-reference="candidate" data-reference-id="C-55555555">di Luca</a>');
    expect(html).toContain('<a href="trama:ref/issue/13" title="#13: Annullo" data-reference="issue" data-reference-id="#13">issue #13</a>');
  });

  it("keeps code for paths and turns an id in code into its name", () => {
    const html = render("Vedi `Sources/Orders/Cancel.swift` e `A-11111111`.");
    expect(html).toContain('<a href="trama:ref/file/Sources%2FOrders%2FCancel.swift" title="Sources/Orders/Cancel.swift: File del modulo Orders" data-reference="file" data-reference-id="Sources/Orders/Cancel.swift"><code>Sources/Orders/Cancel.swift</code></a>');
    expect(html).toContain(">incarico di Luca</a>");
  });

  it("leaves an unknown id as text with a hover, and existing links and code blocks alone", () => {
    const html = render("C-AC540E8F non esiste. [la #13](https://github.com/o/r/issues/13)\n\n```\nC-55555555\n```");
    expect(html).toContain('<span data-reference-unknown="C-AC540E8F" title="Trama non trova C-AC540E8F tra i dati di questo progetto">C-AC540E8F</span>');
    expect(html).toContain('<a href="https://github.com/o/r/issues/13">la #13</a>');
    expect(html).toContain("<code>C-55555555\n</code>");
  });
});
