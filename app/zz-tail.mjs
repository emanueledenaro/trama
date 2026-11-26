import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
const t = await p.evaluate(() => document.body.innerText);
console.log(t.slice(-2500));
const globe = await p.evaluate(() => [...document.querySelectorAll("button")].filter(b => /internet|accesso|access/i.test(b.getAttribute("aria-label")||"")).map(b => b.getAttribute("aria-label")+" pressed="+b.getAttribute("aria-pressed")));
console.log("GLOBE", globe);
await b.close();
