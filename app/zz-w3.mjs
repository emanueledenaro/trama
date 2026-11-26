import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
await p.locator('[aria-label="Aspetta te"]').first().click(); await p.waitForTimeout(1200);
const el = p.locator('[aria-label="Elenco di ciò che aspetta te"]');
console.log((await el.count()) ? (await el.first().innerText()).slice(0,1500) : "no list");
await p.screenshot({ path: "/private/tmp/claude-501/-Users-emanueledenaro-Documents-progetti-trama/64033fc0-b9ac-490f-a99a-429182e0e14e/scratchpad/sim/wait.png" });
await b.close();
