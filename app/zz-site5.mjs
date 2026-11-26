import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const [u,n] of [["/conto-alla-rovescia/","conto"],["/","home5"]]) { await p.goto("http://127.0.0.1:48912"+u); await p.screenshot({ path: "/private/tmp/claude-501/-Users-emanueledenaro-Documents-progetti-trama/64033fc0-b9ac-490f-a99a-429182e0e14e/scratchpad/sim/site-"+n+".png", fullPage: true }); }
await b.close();
