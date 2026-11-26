import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
await p.getByRole("button", { name: /Approva e unisci/ }).first().click(); await p.waitForTimeout(3000);
console.log((await p.evaluate(() => document.body.innerText)).slice(-500));
await b.close();
