import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { remarkCallouts } from "./remarkCallouts";

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkCallouts] }, text));

describe("remarkCallouts", () => {
  it("turns an alert marker into a labelled callout and drops the marker", () => {
    const html = render("> [!DECISION]\n> Usiamo **SQLite** per la cache.");
    expect(html).toContain('class="chat-callout chat-callout--decision"');
    expect(html).toContain('data-label="Decisione"');
    expect(html).toContain("Usiamo <strong>SQLite</strong> per la cache.");
    expect(html).not.toContain("[!DECISION]");
  });

  it("accepts the body on the marker's line and any letter case", () => {
    const html = render("> [!warning] Il test apre la rete.");
    expect(html).toContain("chat-callout--warning");
    expect(html).toContain("<p>Il test apre la rete.</p>");
  });

  it("leaves plain quotes and unknown markers alone", () => {
    expect(render("> una citazione")).toBe("<blockquote>\n<p>una citazione</p>\n</blockquote>");
    expect(render("> [!FOO] testo")).not.toContain("chat-callout");
  });
});
