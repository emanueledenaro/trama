import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("chat blocks", () => {
  it("shows a comparison table as option cards and highlights the recommended one", () => {
    const html = render("| Criterio | WSL 2 | Docker (consigliata) |\n|---|---|---|\n| Setup | complesso | semplice |\n| Velocità | alta | media |");
    expect(html).not.toContain("<table");
    expect(html.match(/chat-compare__card/g)).toHaveLength(3); // two cards, one also --recommended
    expect(html).toContain("chat-compare__card chat-compare__card--recommended");
    expect(html).toContain('<span>Docker</span><span class="chat-compare__badge">Consigliata</span>');
    expect(html).toContain("<dt>Setup</dt><dd>semplice</dd>");
  });

  it("keeps a table that is not a comparison of two or three options", () => {
    expect(render("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
  });

  it("renders a callout with its icon and label", () => {
    const html = render("> [!BLOCKED]\n> Manca il token.");
    expect(html).toContain('class="chat-callout chat-callout--blocked"');
    expect(html).toMatch(/<div class="chat-callout__label">Bloccato<\/div>\s*<p>Manca il token\.<\/p>/);
    expect(html).toContain('class="chat-callout__icon"');
  });
});
