// Builds Trama's icons (person's note, 1 October 2026) from the Tabler icons the renderer imports: the geometry stays
// Tabler's (MIT, see THIRD_PARTY_NOTICES.md) and each icon gets two threads, as the two ribbons of the logo. The stroke
// the others pass over (where they cross or one ends on another), or else the longest one, is the back thread and is
// drawn faint; the rest stays full. Run with `node scripts/build-trama-icons.mjs` after adding an icon; it writes
// src/renderer/components/icons/woven.generated.ts.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const tablerDir = join(root, "node_modules/@tabler/icons-react/dist/esm/icons");
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const used = new Set();
for (const file of files(join(root, "src/renderer")).filter((f) => /\.tsx?$/.test(f))) {
  for (const m of readFileSync(file, "utf8").matchAll(/\bIcon[A-Z][A-Za-z0-9]*\b/g)) used.add(m[0]);
}
const icons = {};
for (const name of [...used].sort()) {
  let source;
  try {
    source = readFileSync(join(tablerDir, `${name}.mjs`), "utf8");
  } catch {
    continue; // Not a Tabler icon, such as IconButton.
  }
  const { __iconNode } = await import(join(tablerDir, `${name}.mjs`));
  icons[name] = { filled: /createReactComponent\("filled"/.test(source), node: __iconNode.map(([tag, { key, ...attrs }]) => [tag, attrs]) };
}

// Where the rule picks the wrong thread, the back threads by hand ([] keeps the icon in one thread): twin marks such as
// two arrows or three dots have no back, and a few drawings read better with a chosen one.
const BACK = {
  IconArrowsSort: [], IconArrowsDiagonal: [], IconArrowsDiagonalMinimize2: [], IconArrowsSplit: [], IconDots: [], IconX: [],
  IconPlus: [], IconPlayerPause: [], IconPlayerTrackNext: [], IconSun: [], IconHandStop: [], IconLanguage: [], IconTools: [],
  IconBug: [], IconPin: [], IconPinned: [], IconPinnedOff: [],
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<svg id=s xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'></svg>");
const backs = await page.evaluate((icons) => {
  const svg = document.getElementById("s");
  const out = {};
  for (const [name, { filled, node }] of Object.entries(icons)) {
    out[name] = [];
    if (filled) continue;
    svg.innerHTML = node.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
    const all = [...svg.children];
    const els = all.filter((e) => e.getAttribute("d") !== "M0 0h24v24H0z");
    const samples = els.map((e) => {
      const L = e.getTotalLength();
      const n = Math.max(2, Math.ceil(L / 0.08));
      return Array.from({ length: n + 1 }, (_, i) => {
        const q = e.getPointAtLength((L * i) / n);
        return [q.x, q.y, (L * i) / n, L];
      });
    });
    const found = [];
    // Crossings: the earlier stroke passes under, alternating when the same two cross again.
    for (let i = 0; i < samples.length; i++)
      for (let j = i + 1; j < samples.length; j++) {
        const A = samples[i], B = samples[j];
        let k = 0;
        for (let a = 1; a < A.length - 1; a++)
          for (let c = 1; c < B.length - 1; c++) {
            const [p1, p2, q1, q2] = [A[a - 1], A[a], B[c - 1], B[c]];
            const r = [p2[0] - p1[0], p2[1] - p1[1]], s = [q2[0] - q1[0], q2[1] - q1[1]];
            const den = r[0] * s[1] - r[1] * s[0];
            if (Math.abs(den) < 1e-9) continue;
            const t = ((q1[0] - p1[0]) * s[1] - (q1[1] - p1[1]) * s[0]) / den;
            const u = ((q1[0] - p1[0]) * r[1] - (q1[1] - p1[1]) * r[0]) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            if (A[a][2] < 1.4 || A[a][3] - A[a][2] < 1.4 || B[c][2] < 1.4 || B[c][3] - B[c][2] < 1.4) continue;
            let diff = Math.abs(Math.atan2(r[1], r[0]) - Math.atan2(s[1], s[0])) % Math.PI;
            diff = Math.min(diff, Math.PI - diff);
            if (diff < 0.44) continue;
            if (found.some((g) => Math.hypot(g.x - A[a][0], g.y - A[a][1]) < 1.5)) continue;
            found.push({ x: +A[a][0].toFixed(2), y: +A[a][1].toFixed(2), under: all.indexOf(els[k++ % 2 ? j : i]), r: 2.5 });
          }
      }
    // Joints: an open stroke that ends on the middle of another one is tucked under it.
    for (let i = 0; i < samples.length; i++) {
      const A = samples[i];
      const s0 = A[0], s1 = A[A.length - 1];
      if (["circle", "rect", "ellipse"].includes(els[i].tagName) || Math.hypot(s0[0] - s1[0], s0[1] - s1[1]) < 0.1) continue;
      for (const end of [s0, s1])
        for (let j = 0; j < samples.length; j++) {
          if (j === i) continue;
          const near = samples[j].some((q) => q[2] > 1 && q[3] - q[2] > 1 && Math.hypot(q[0] - end[0], q[1] - end[1]) < 0.5);
          if (near && !found.some((g) => Math.hypot(g.x - end[0], g.y - end[1]) < 1.2)) found.push({ x: +end[0].toFixed(2), y: +end[1].toFixed(2), under: all.indexOf(els[i]), r: 1.7 });
        }
    }
    const strokes = els.filter((e) => e.getTotalLength() > 2);
    if (strokes.length < 2) continue;
    const under = [...new Set(found.map((g) => g.under))];
    if (under.length && under.length < strokes.length) out[name] = under;
    else out[name] = [all.indexOf(els.reduce((a, e) => (e.getTotalLength() > a.getTotalLength() ? e : a)))];
  }
  return out;
}, icons);
await browser.close();

const lines = [
  "// Generated by scripts/build-trama-icons.mjs from @tabler/icons-react (MIT, see THIRD_PARTY_NOTICES.md). Do not edit by hand.",
  "",
  'import type { WovenIcon } from "./woven";',
  "",
  "export const WOVEN_ICONS: Record<string, WovenIcon> = {",
  ...Object.entries(icons).map(([name, { filled, node }]) => `  ${name}: ${JSON.stringify({ filled, node, back: BACK[name] ?? backs[name] })},`),
  "};",
  "",
];
writeFileSync(join(root, "src/renderer/components/icons/woven.generated.ts"), lines.join("\n"));
console.log(`${Object.keys(icons).length} icons, ${Object.keys(icons).filter((n) => (BACK[n] ?? backs[n]).length).length} in two threads`);
