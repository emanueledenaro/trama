import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
const t = await p.evaluate(() => document.body.innerText);
const i = t.indexOf("Aspetta te"); console.log(i>=0 ? t.slice(i, i+1200) : "no panel");
console.log("----"); console.log(t.slice(-700));
await b.close();
