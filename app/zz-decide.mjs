import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
await p.getByRole("button", { name: /^Decidi$/ }).first().click(); await p.waitForTimeout(1500);
const dir="/private/tmp/claude-501/-Users-emanueledenaro-Documents-progetti-trama/64033fc0-b9ac-490f-a99a-429182e0e14e/scratchpad/sim/";
await p.screenshot({ path: dir+"s4-review.png" });
const imgs = await p.evaluate(() => [...document.querySelectorAll("img")].map(i=>i.src).filter(s=>!s.includes("avatar")).slice(0,20));
console.log(imgs);
await b.close();
