import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript without type declarations.
import { annotation, checkDiff, checkLine, parseDiff } from "./check-design-rules.mjs";

type Hit = { rule: string; match: string };
const TSX = "app/src/renderer/components/Sample.tsx";
const line = (text: string, file = TSX, previous: string | null = null) => ({ file, line: 1, text, previous });
const rules = (text: string, file = TSX, previous: string | null = null) => (checkLine(line(text, file, previous)) as Hit[]).map((h) => h.rule);

function diffOf(file: string, hunks: { start: number; lines: string[] }[]) {
  const body = hunks.map((h) => `@@ -${h.start},0 +${h.start},${h.lines.length} @@\n${h.lines.join("\n")}`).join("\n");
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${body}\n`;
}

describe("parseDiff", () => {
  it("numbers added lines from the hunk header and ignores removed and context lines", () => {
    const diff = diffOf(TSX, [{ start: 10, lines: [" keep", "-gone", "+new one", "+new two"] }]);
    expect(parseDiff(diff)).toEqual([
      { file: TSX, line: 11, text: "new one", previous: "keep" },
      { file: TSX, line: 12, text: "new two", previous: "new one" },
    ]);
  });

  it("skips deleted files and does not mistake an added line starting with ++ for a header", () => {
    const deleted = "diff --git a/x.tsx b/x.tsx\n--- a/x.tsx\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
    expect(parseDiff(deleted)).toEqual([]);
    const odd = diffOf(TSX, [{ start: 1, lines: ["+++ odd"] }]);
    expect(parseDiff(odd).map((l: { text: string }) => l.text)).toEqual(["++ odd"]);
  });
});

describe("spacing-scale", () => {
  it("flags steps off the 8 px grid", () => {
    expect(rules('<div className="p-3 gap-1.5 mx-2.5 -mt-5">')).toEqual(["spacing-scale", "spacing-scale", "spacing-scale", "spacing-scale"]);
    expect(rules('<div className="md:px-3 hover:!gap-3.5 size-3.5">')).toEqual(["spacing-scale", "spacing-scale", "spacing-scale"]);
  });

  it("accepts 0, 0.5, 1 and the even steps, and ignores fractions and named sizes", () => {
    expect(rules('<div className="p-0 px-0.5 gap-1 m-2 p-4 gap-6 w-8 h-12 size-16 space-y-4 w-1/2 max-w-2xl top-3 text-ui">')).toEqual([]);
  });
});

describe("arbitrary-pixel-value", () => {
  it("flags single pixel values", () => {
    expect(rules('<div className="p-[13px] w-[37px] md:text-[11px]">')).toEqual(["arbitrary-pixel-value", "arbitrary-pixel-value", "arbitrary-pixel-value"]);
  });

  it("accepts 0px, calc and multi-part values", () => {
    expect(rules('<div className="m-[0px] px-[calc(--spacing(3)-1px)] shadow-[0_4px_18px_-6px_red] min-[560px]:flex max-[480px]:hidden">')).toEqual([]);
  });
});

describe("raw-color", () => {
  it("flags hex and color functions in code", () => {
    expect(rules('<path fill="#D97757" />')).toEqual(["raw-color"]);
    expect(rules('style={{ color: "#fff" }} className="bg-[#1a1a1a] shadow-[0_0_4px_rgb(255_255_255/0.9)]"')).toEqual(["raw-color", "raw-color", "raw-color"]);
  });

  it("accepts tokens, url fragments, anchors and issue references in comments", () => {
    expect(rules('<div className="bg-primary text-[var(--color-text-foreground)]" style={{ color: "rgb(var(--x) / 0.5)" }} />')).toEqual([]);
    expect(rules('<use href="#icon" /> <rect fill="url(#grad)" />')).toEqual([]);
    expect(rules("// see issue #314 and #ff0000", TSX)).toEqual([]);
    expect(rules("const a = 1; // fixes #314")).toEqual([]);
  });

  it("skips the continuation lines of a block comment and mask gradients", () => {
    const css = "app/src/renderer/index.css";
    const lines = ["/* Codex seed", "   ink #0d0d0d, accent #0169cc. */", "a { color: #fff; }"];
    expect(checkLine(line("   ink #0d0d0d, accent #0169cc. */", css), lines, 1)).toEqual([]);
    expect((checkLine(line("a { color: #fff; }", css), lines, 2) as Hit[]).map((h) => h.rule)).toEqual(["raw-color"]);
    expect(rules("  -webkit-mask-image: linear-gradient(to bottom, #000 80%, transparent);", css)).toEqual([]);
  });

  it("allows colors where index.css defines the tokens, not in its rules", () => {
    const css = "app/src/renderer/index.css";
    expect(rules("  --warning: #b45309;", css)).toEqual([]);
    expect(rules("  color: #b45309;", css)).toEqual(["raw-color"]);
    expect(rules("  color: #b45309;", "app/src/renderer/components/x.css")).toEqual(["raw-color"]);
  });
});

describe("gradient", () => {
  it("flags utility and CSS gradients", () => {
    expect(rules('<div className="bg-gradient-to-r from-primary" />')).toEqual(["gradient"]);
    expect(rules('<div className="bg-linear-to-b bg-radial" />')).toEqual(["gradient", "gradient"]);
    expect(rules("  background: linear-gradient(var(--a), var(--b));", "app/src/renderer/components/x.css")).toEqual(["gradient"]);
  });

  it("allows a gradient inside a token declaration in index.css", () => {
    expect(rules("  --surface: linear-gradient(var(--a), var(--b));", "app/src/renderer/index.css")).toEqual([]);
  });
});

describe("second-filled-button (fixed roles)", () => {
  it("flags an explicit filled Button outside WaitingView", () => {
    expect(rules('<Button size="sm" variant="default" onClick={go}>')).toEqual(["second-filled-button"]);
  });

  it("finds the Button when variant sits on its own line, and skips other components", () => {
    const lines = ["<Button", '  size="sm"', '  variant="default"', ">"];
    expect((checkLine(line('  variant="default"'), lines, 2) as Hit[]).map((h) => h.rule)).toEqual(["second-filled-button"]);
    const badge = ["<Badge", '  variant="default"', ">"];
    expect(checkLine(line('  variant="default"'), badge, 1)).toEqual([]);
  });

  it("allows the files that own the filled button and the variant definition", () => {
    expect(rules('<Button variant="default">', "app/src/renderer/components/WaitingView.tsx")).toEqual([]);
    expect(rules('<Button variant="default">', "app/src/renderer/components/WaitingPointer.tsx")).toEqual([]);
    expect(rules('<Button variant="default">', "app/src/renderer/components/ui/button.tsx")).toEqual([]);
  });

  it("leaves outline buttons and variant-less buttons alone", () => {
    expect(rules('<Button size="xs" variant="outline">')).toEqual([]);
    expect(rules('<Button size="xs">')).toEqual([]);
  });
});

describe("untranslated-text", () => {
  it("flags text and labels written in the JSX", () => {
    expect(rules("<p>Nessun risultato</p>")).toEqual(["untranslated-text"]);
    expect(rules('<input placeholder="Cerca" aria-label="Campo di ricerca" />')).toEqual(["untranslated-text", "untranslated-text"]);
  });

  it("accepts t() calls, expressions and code that only looks like JSX", () => {
    expect(rules('<p>{t("waiting.view.emptyList")}</p>')).toEqual([]);
    expect(rules('<input aria-label={t("search.label")} />')).toEqual([]);
    expect(rules("const go = (a: number) => a < 3 && a > 1;")).toEqual([]);
    expect(rules("const items: Array<Foo> = useRef<Map<string, Bar>>(null);")).toEqual([]);
    expect(rules('import type { Foo } from "./Foo";')).toEqual([]);
  });
});

describe("design-rules-ignore", () => {
  it("silences a line that carries the comment with a reason", () => {
    expect(rules('<div className="p-3" /> {/* design-rules-ignore: alignment with the native title bar */}')).toEqual([]);
    expect(rules('const c = "#fff"; // design-rules-ignore: brand logo')).toEqual([]);
  });

  it("silences the line below a comment-only line", () => {
    expect(rules('<div className="p-3" />', TSX, "  {/* design-rules-ignore: matches the legacy header */}")).toEqual([]);
    expect(rules('<div className="p-3" />', TSX, "  // design-rules-ignore: legacy")).toEqual([]);
  });

  it("does not silence a line when the previous line is code", () => {
    expect(rules('<div className="p-3" />', TSX, 'const x = 1; // design-rules-ignore: nope')).toEqual(["spacing-scale"]);
  });

  it("requires a reason", () => {
    expect(rules('<div className="p-3" /> // design-rules-ignore:')).toEqual(["ignore-without-reason"]);
    expect(rules('<div className="p-3" /> {/* design-rules-ignore:   */}')).toEqual(["ignore-without-reason"]);
  });
});

describe("checkDiff", () => {
  it("reports only added lines, so code that is already there stays quiet", () => {
    const diff = diffOf(TSX, [{ start: 5, lines: [' <div className="p-3 bg-[#123456]">', '+<div className="gap-4">', '+<div className="gap-5">'] }]);
    const found = checkDiff(diff);
    expect(found.map((v: { line: number; rule: string }) => [v.line, v.rule])).toEqual([[7, "spacing-scale"]]);
  });

  it("ignores files outside the renderer, tests and other extensions", () => {
    const bad = ['+<div className="p-3 bg-[#fff]">'];
    expect(checkDiff(diffOf("app/src/main/ui.tsx", [{ start: 1, lines: bad }]))).toEqual([]);
    expect(checkDiff(diffOf("app/src/renderer/components/a.test.tsx", [{ start: 1, lines: bad }]))).toEqual([]);
    expect(checkDiff(diffOf("app/src/renderer/lib/a.ts", [{ start: 1, lines: bad }]))).toEqual([]);
  });

  it("uses the file to find the Button of a variant on its own line", () => {
    const diff = diffOf(TSX, [{ start: 3, lines: ['+  variant="default"'] }]);
    const found = checkDiff(diff, () => ["x", "<Button", '  variant="default"']);
    expect(found.map((v: { rule: string }) => v.rule)).toEqual(["second-filled-button"]);
  });
});

describe("annotation", () => {
  const violation = { file: TSX, line: 7, rule: "spacing-scale", level: "error", message: "Regola: 100%\nvedi doc" };

  it("is a warning unless enforced, and an error only for error-level rules when enforced", () => {
    expect(annotation(violation, false)).toMatch(/^::warning /);
    expect(annotation(violation, true)).toMatch(/^::error /);
    expect(annotation({ ...violation, level: "warning" }, true)).toMatch(/^::warning /);
  });

  it("escapes the message and properties", () => {
    const text = annotation(violation, false);
    expect(text).toContain(`file=${TSX},line=7,title=design-rules/spacing-scale::`);
    expect(text).toContain("100%25%0Avedi doc");
  });
});
