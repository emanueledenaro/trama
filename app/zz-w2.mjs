import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
console.log(await p.evaluate(() => [...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).filter(l=>/aspetta|attesa|waiting/i.test(l)).slice(0,10)));
const t = await p.evaluate(() => document.body.innerText); const i=t.lastIndexOf("cosa aspetta te"); console.log(i>=0? t.slice(i-200,i+50):"none");
await b.close();
