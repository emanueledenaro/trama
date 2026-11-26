import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
const g = p.locator('button[aria-label^="Internet e comandi degli agenti"]');
console.log(await g.getAttribute("aria-label"));
if (/acceso/.test(await g.getAttribute("aria-label"))) { await g.click(); await p.waitForTimeout(800); }
console.log(await g.getAttribute("aria-label"));
await b.close();
