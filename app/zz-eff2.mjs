import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9333");
const p = b.contexts()[0].pages()[0];
const s = p.getByRole("slider", { name: "Sforzo" });
console.log(await s.getAttribute("aria-valuenow"), await s.getAttribute("aria-valuemin"), await s.getAttribute("aria-valuetext"));
await s.focus();
for (let i = 0; i < 6; i++) { const t = await s.getAttribute("aria-valuetext"); if (/basso/i.test(t||"") && !/molto/i.test(t||"")) break; await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(200); }
console.log(await s.getAttribute("aria-valuetext"));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
console.log(await p.locator('button[aria-label^="Provider e modello del Coordinatore"]').innerText());
await b.close();
