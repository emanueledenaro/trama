import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
console.log(await p.evaluate(() => { const ta=document.querySelector('textarea'); const root=ta?.closest('form')||ta?.parentElement?.parentElement?.parentElement; return [...(root||document).querySelectorAll('button')].map(x=>(x.getAttribute('aria-label')||'')+' | '+x.innerText.trim()).slice(0,30); }));
await b.close();
