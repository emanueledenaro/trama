import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
const ta = p.locator("textarea").first();
await ta.click(); await ta.fill(process.argv[2]); await p.waitForTimeout(300);
await p.locator('button[aria-label="Invia al Coordinatore"]').click();
await p.waitForTimeout(2000);
console.log((await p.evaluate(() => document.body.innerText)).slice(-800));
await b.close();
