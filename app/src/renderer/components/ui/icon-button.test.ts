import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";

const RENDERER = join(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [path] : [];
  });
}

/** The opening tags of `tag` in a TSX source, with the braces of their props balanced. */
function openingTags(source: string, tag: string): string[] {
  const tags: string[] = [];
  const start = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (let match = start.exec(source); match; match = start.exec(source)) {
    let depth = 0;
    let quote: string | null = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote && source[end - 1] !== "\\") quote = null;
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      } else if (char === ">" && depth === 0) {
        break;
      }
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

describe("IconButton (issue #338)", () => {
  it("uses its name as the tooltip trigger's accessible name", () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: "Apri il diff", icon: createElement("svg") }));
    expect(html).toContain('aria-label="Apri il diff"');
    expect(html).toContain("data-icon-button");
  });

  it("shows the count next to the icon and keeps the name", () => {
    const html = renderToStaticMarkup(createElement(IconButton, { label: "Dettagli (2)", icon: createElement("svg"), count: 2 }));
    expect(html).toContain('aria-label="Dettagli (2)"');
    expect(html).toMatch(/<span aria-hidden="true" class="tabular-nums">2<\/span>/);
  });

  it("finds the opening tag across lines and nested braces", () => {
    const tags = openingTags('<Button\n  size="icon-xs"\n  onClick={() => go({ a: 1 })}\n>x</Button>', "Button");
    expect(tags).toEqual(['<Button\n  size="icon-xs"\n  onClick={() => go({ a: 1 })}\n>']);
  });

  it("gives every icon-only Button of the renderer an accessible name", () => {
    const nameless = sources(RENDERER).flatMap((file) =>
      openingTags(readFileSync(file, "utf8"), "Button")
        .filter((tag) => /\bsize=["{]\s*"?icon/.test(tag) && !/\baria-label(ledby)?=/.test(tag))
        .map((tag) => `${relative(RENDERER, file)}: ${tag.split("\n")[0]}`),
    );
    expect(nameless).toEqual([]);
  });
});
