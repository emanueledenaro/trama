import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
await p.screenshot({ path: process.argv[2] });
console.log((await p.evaluate(() => document.body.innerText)).slice(0, 3000));
await b.close();
