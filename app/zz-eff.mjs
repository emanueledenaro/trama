import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
await p.locator('button[aria-label^="Provider e modello del Coordinatore"]').click(); await p.waitForTimeout(800);
console.log(await p.evaluate(() => [...document.querySelectorAll('[role=menu] [role], [role=dialog] button, [role=dialog] [role], [data-radix-popper-content-wrapper] *')].map(e=>(e.getAttribute('role')||e.tagName)+':'+(e.getAttribute('aria-label')||e.innerText||'').trim().slice(0,40)).filter(s=>s.length>4).slice(0,40)));
await p.screenshot({ path: "/private/tmp/claude-501/-Users-emanueledenaro-Documents-progetti-trama/64033fc0-b9ac-490f-a99a-429182e0e14e/scratchpad/sim/eff.png" });
await b.close();
