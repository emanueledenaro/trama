// Shared pieces of the three prototypes (issue #314): helpers, the sample data of the "negozio" project and the
// content of each view. a.js, b.js and c.js only decide where each piece goes. Static: nothing here talks to Trama.
window.PROTO_ERRORS = [];
window.addEventListener("error", (e) => window.PROTO_ERRORS.push(e.message));

const params = new URLSearchParams(location.search);
const STATE = params.get("vista") ?? "principale";
const THEME = params.get("tema") ?? "chiaro";
const STATES = ["principale", "aspetta", "squadre", "specialista", "lavoro", "regole", "memoria", "panoramica", "impostazioni"];
const STATE_LABELS = {
  principale: "Finestra principale",
  aspetta: "Aspetta te",
  squadre: "Squadre",
  specialista: "Specialista",
  lavoro: "Lavoro",
  regole: "Regole",
  memoria: "Memoria",
  panoramica: "Panoramica",
  impostazioni: "Impostazioni",
};

// --- Helpers ------------------------------------------------------------------------------------------------

function ic(name, cls = "") {
  const paths = window.ICONS?.[name];
  if (!paths) {
    window.PROTO_ERRORS.push(`missing icon ${name}`);
    return "";
  }
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

/**
 * A button of components/ui/button.tsx. Icon-only buttons always carry a tooltip and an aria-label.
 * `urgent` marks the one urgent action of the window (counted by genera.mjs).
 */
function btn({ text = "", icon = null, variant = "ghost", size = null, title = null, urgent = false, on = false, badge = null }) {
  const iconOnly = icon && !text;
  const s = size ?? (iconOnly ? "icon-sm" : "sm");
  const label = title ?? text;
  const attrs = [
    `class="btn b-${s}${on ? " is-on" : ""}"`,
    `data-variant="${variant}"`,
    iconOnly ? `title="${label}" aria-label="${label}"` : "",
    urgent ? "data-urgente" : "",
  ].join(" ");
  return `<button type="button" ${attrs}>${icon ? ic(icon) : ""}${text}${badge ? ` <span class="badge">${badge}</span>` : ""}</button>`;
}

const cta = (...buttons) => `<div class="cta-row">${buttons.join("")}</div>`;

// --- Sample data: the "negozio" project ----------------------------------------------------------------------

// Colors from the identity palette of src/shared/identity.ts (light and dark shade).
const AGENTS = {
  marco: { name: "Marco", role: "Capo squadra", team: "Checkout", colors: ["#4338ca", "#a5b4fc"] },
  elena: { name: "Elena", role: "Sviluppatrice", team: "Checkout", colors: ["#115e59", "#5eead4"] },
  paolo: { name: "Paolo", role: "Sviluppatore", team: "Checkout", colors: ["#9a3412", "#fdba74"] },
  luca: { name: "Luca", role: "QA", team: "Checkout", colors: ["#6d28d9", "#c4b5fd"] },
  giulia: { name: "Giulia", role: "Capo squadra", team: "Catalogo", colors: ["#9d174d", "#f9a8d4"] },
  sara: { name: "Sara", role: "Sviluppatrice", team: "Catalogo", colors: ["#155e75", "#67e8f9"] },
  andrea: { name: "Andrea", role: "QA", team: "Catalogo", colors: ["#3f6212", "#bef264"] },
};

function avatar(key, cls = "") {
  const a = AGENTS[key];
  return `<span class="avatar agent-identity ${cls}" style="--agent-light:${a.colors[0]};--agent-dark:${a.colors[1]}">${a.name[0]}</span>`;
}
function tag(key, text) {
  const a = AGENTS[key];
  return `<span class="tag agent-identity" style="--agent-light:${a.colors[0]};--agent-dark:${a.colors[1]}">${text}</span>`;
}

const PROJECT = { name: "negozio", branch: "chore/pre-apertura", goal: "Apertura controllata di MondoPet" };
const STATUS_TEXT = "Riallineo chore/pre-apertura con main, poi verifico la fetta di Elena";

// --- Chat --------------------------------------------------------------------------------------------------

function chatTimeline() {
  return `
  <div class="timeline">
    <div class="day">Oggi</div>
    <div class="msg-user">Partiamo dalle spedizioni: devono esserci prima dell'apertura.</div>
    <div class="msg-ai"><p>Ho diviso il lavoro in quattro fette per la squadra Checkout: matrice delle taglie, spese di spedizione per zona, pagamento con PayPal e pagina di stato dell'ordine. Marco le ha stimate con la squadra.</p></div>
    <div class="line">${ic("list-check")}<span class="t truncate">Piano: Spedizioni e pagamenti</span><span>4 fette</span><span class="end">${ic("chevron-right")}</span></div>
    <div class="line">${ic("file-text")}<span class="t truncate">Riepilogo delle 11:40</span><span>1 fetta unita, 1 in corso</span><span class="end">${ic("chevron-right")}</span></div>
    <div class="msg-user">Com'è messa la parte delle spedizioni?</div>
    <div class="msg-ai">
      <p>Elena ha finito il calcolo per Italia ed Europa: 3 esempi su 5 passano. Mancano le isole minori e il ritiro in negozio.</p>
      <p>Luca prepara i test sulle soglie della spedizione gratuita. Paolo è fermo sul pagamento con PayPal finché non decidi sulla proposta di mandato.</p>
    </div>
    <div class="line">${avatar("elena")}<span class="t truncate">Elena ha lavorato per 12 min</span><span>8 passi</span><span class="end">${ic("chevron-right")}</span></div>
    <div class="line">${ic("file-diff")}<span class="t truncate">Candidato: Spese di spedizione per zona</span><span class="end"><span class="chip info">In corso</span></span></div>
    <div class="line">${ic("hourglass")}<span class="t truncate">Proposta di mandato v3</span><span>in Aspetta te</span><span class="end">${ic("chevron-right")}</span></div>
    <div class="msg-user">E il conflitto con main?</div>
    <div class="msg-ai">
      <p>Su main sono arrivati 7 commit della squadra Catalogo e il nostro branch ne ha 13. I file in conflitto sono 18, quasi tutti in <code>app/checkout</code>.</p>
      <p>Li riallineo io, dentro il mandato. Se trovo una scelta di prodotto te la metto in Aspetta te.</p>
    </div>
  </div>`;
}

/** The line above the composer: the first thing that waits for the person, and the count. */
function waitingLine() {
  return `
  <div class="waiting-line" data-urgente-riga>
    <span class="accent">${ic("hourglass", "s14")}</span>
    <span class="t truncate grow"><b>Proposta di mandato v3</b> <span class="muted">· ferma 1 fetta · e un'altra cosa</span></span>
    ${btn({ text: "Decidi", variant: "default", urgent: true })}
  </div>`;
}

function composer() {
  return `
  <div class="composer">
    <div class="ph">Messaggio al Coordinatore. @ per citare, / per una skill</div>
    <div class="tools">
      ${btn({ icon: "photo-plus", title: "Allega immagini" })}
      ${btn({ icon: "at", text: "Intero progetto", size: "xs" })}
      ${btn({ text: "gpt-6-luna · Alto", size: "xs" })}
      <span class="grow"></span>
      <button type="button" class="send" title="Invia" aria-label="Invia">${ic("arrow-up")}</button>
    </div>
  </div>`;
}

/** The conversation column: timeline, then the line of Aspetta te (unless its view is open) and the composer. */
function conversation({ showWaiting = true } = {}) {
  return `
  <div class="scroll" data-misura="conversazione">
    <div class="chat-col">${chatTimeline()}</div>
  </div>
  <div class="dock"><div class="chat-col">${showWaiting ? waitingLine() : ""}${composer()}</div></div>`;
}

/** One line: what the Coordinator does now and the work in focus. Activity and Pause are icons. */
function statusLine() {
  return `
  <div class="status-line">
    <span class="spinner"></span>
    <span class="truncate grow">${STATUS_TEXT}</span>
    <span class="goal-chip truncate">${ic("target", "s14")}<span class="truncate">${PROJECT.goal}</span></span>
    ${btn({ icon: "list-details", title: "Attività" })}
    ${btn({ icon: "player-pause", title: "Pausa del Coordinatore" })}
  </div>`;
}

// --- Views --------------------------------------------------------------------------------------------------

function viewAspetta() {
  return `
  <div class="view">
    <div class="summary">
      <div class="lead">2 cose aspettano te</div>
      <div class="sm muted">In ordine di quanto lavoro fermano. Mentre aspetti, il Coordinatore lavora sul resto.</div>
    </div>
    <div class="section">
      <div class="card urgent"><div class="card-body">
        <div class="row"><h3 class="grow truncate">Proposta di mandato v3</h3><span class="chip warn">Ferma 1 fetta</span></div>
        <div class="sm">Il Coordinatore chiede di aprire pull request verso main per il modulo checkout e di unire da solo i candidati verificati che non toccano l'interfaccia. Serve per il pagamento con PayPal di Paolo.</div>
        ${cta(btn({ text: "Rifiuta", variant: "outline" }), btn({ text: "Correggi", variant: "outline" }), btn({ text: "Concedi", variant: "default", urgent: true }))}
        <div class="sm muted" style="margin-top:4px">Cosa cambia rispetto al mandato v2</div>
        <div class="diff-line add"><b>+</b><span>Aprire pull request verso main, solo per checkout</span></div>
        <div class="diff-line add"><b>+</b><span>Unire i candidati verificati senza modifiche all'interfaccia</span></div>
        <div class="diff-line same"><b>=</b><span>Perimetro, azioni e divieti fissi come nella v2</span></div>
        <div class="closed-sec" style="padding:0">${ic("chevron-right", "s14")}Confronto completo e motivazione</div>
      </div></div>
    </div>
    <div class="section">
      <div class="item tall">
        <span class="muted">${ic("brain", "s14")}</span>
        <div class="col grow">
          <div>Memoria: i prezzi si mostrano sempre IVA inclusa</div>
          <div class="meta">Proposta dopo la revisione di ieri · non ferma il lavoro</div>
        </div>
      </div>
      <div style="padding:0 8px 6px">${cta(btn({ text: "Scarta", variant: "outline", size: "xs" }), btn({ text: "Applica", variant: "outline", size: "xs" }))}</div>
    </div>
    <div class="section"><div class="closed-sec">${ic("chevron-right", "s14")}Decise oggi · 3</div></div>
  </div>`;
}

function agentItem(key, meta, end) {
  const a = AGENTS[key];
  return `<div class="item">${avatar(key)}<div class="col grow"><div class="row"><span>${a.name}</span>${tag(key, a.role === "Capo squadra" ? "capo squadra" : a.role === "QA" ? "QA" : "")}</div><div class="meta truncate">${meta}</div></div><span class="end">${end}</span></div>`;
}

function viewSquadre() {
  return `
  <div class="view">
    <div class="summary">
      <div class="lead">1 squadra al lavoro</div>
      <div class="sm muted">4 persone della squadra lavorano ora. Nessuno tocca gli stessi file.</div>
      <div class="row sm muted">${ic("users", "s14")}<span class="truncate">Anna, collega, è su feature/newsletter: nessun file in comune</span></div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="truncate"><b style="color:var(--foreground);font-weight:500">Checkout</b> · sprint «Spedizioni e pagamenti» · 1 di 4 fette</span></div>
      ${agentItem("marco", "Stand-up alle 11:40, prossimo giro alle 12:10", `<span class="dot work" title="Al lavoro"></span>`)}
      ${agentItem("elena", "S2 Spese di spedizione per zona · 3 di 5 esempi", `<span class="dot work" title="Al lavoro"></span>`)}
      ${agentItem("luca", "Test delle soglie di spedizione gratuita", `<span class="dot work" title="Al lavoro"></span>`)}
      ${agentItem("paolo", "Fermo su S3: aspetta il mandato", `<span class="warn" title="Aspetta te">${ic("hourglass", "s14")}</span>`)}
    </div>
    <div class="section">
      <div class="sec-head"><span class="truncate"><b style="color:var(--foreground);font-weight:500">Catalogo</b> · nessuno sprint aperto</span></div>
      ${agentItem("giulia", "Libera", `<span class="dot idle" title="Libera"></span>`)}
      ${agentItem("sara", "Libera", `<span class="dot idle" title="Libera"></span>`)}
      ${agentItem("andrea", "Libero", `<span class="dot idle" title="Libero"></span>`)}
    </div>
    <div class="section"><div class="closed-sec">${ic("chevron-right", "s14")}Ruoli condivisi · 10, 1 al lavoro</div></div>
    <div class="section">
      <div class="sec-head">Lavoro automatico</div>
      <div class="item"><span class="muted">${ic("bug", "s14")}</span><div class="col grow"><div class="truncate">Bug triage sulle issue nuove</div><div class="meta">Ultimo giro alle 11:31 · 1 issue smistata</div></div><span class="end">${btn({ icon: "player-play", text: "Avvia", size: "xs" })}</span></div>
      <div class="item"><span class="muted">${ic("sparkles", "s14")}</span><div class="col grow"><div class="truncate">Revisione Clean Code a squadra libera</div><div class="meta">Prossima: dopo S2</div></div><span class="end">${btn({ icon: "player-play", text: "Avvia", size: "xs" })}</span></div>
    </div>
  </div>`;
}

function viewSpecialista({ back = true } = {}) {
  return `
  <div class="view">
    <div class="summary">
      ${back ? `<div class="crumb">${ic("arrow-left", "s14")}Squadre<span>›</span>Checkout</div>` : ""}
      <div class="row" style="gap:12px">
        ${avatar("elena", "lg")}
        <div class="col grow"><h3>Elena</h3><div class="sm">${tag("elena", "Sviluppatrice · Checkout")}</div></div>
        ${btn({ icon: "message-circle", text: "Chiedi", variant: "outline" })}
        ${btn({ icon: "chevron-down", title: "Altre azioni: Rinomina, Togli dalla squadra" })}
      </div>
      <div class="row sm"><span class="dot work"></span>Al lavoro su S2 dalle 10:05</div>
    </div>
    <div class="section">
      <div class="sec-head">Ora<span class="end">${btn({ icon: "file-diff", title: "Apri il diff", size: "icon-xs" })}${btn({ icon: "focus-2", title: "Esame approfondito", size: "icon-xs" })}</span></div>
      <div class="card" style="margin:0 8px"><div class="card-body">
        <div class="row"><span class="grow truncate">S2 Spese di spedizione per zona</span><span class="chip info">In corso</span></div>
        <div class="progress"><span style="width:60%"></span></div>
        <div class="sm muted">3 di 5 esempi provati. Mancano isole minori e ritiro in negozio.</div>
      </div></div>
    </div>
    <div class="section">
      <div class="sec-head">Ultimo risultato</div>
      <div class="item">${ic("circle-check", "lead")}<div class="col grow"><div class="truncate">S1 Matrice delle taglie</div><div class="meta">Unita ieri alle 18:20 · verifiche 6 di 6</div></div><span class="end"><span class="chip ok">Unita</span>${ic("chevron-right", "s14")}</span></div>
    </div>
    <div class="section">
      <div class="sec-head">Incarichi · 4</div>
      <div class="item">${ic("file-diff", "lead")}<span class="grow truncate">S2 Spese di spedizione per zona</span><span class="meta">in corso</span></div>
      <div class="item">${ic("file-diff", "lead")}<span class="grow truncate">S1 Matrice delle taglie</span><span class="meta">unita</span></div>
      <div class="item">${ic("file-diff", "lead")}<span class="grow truncate">Arrotondamento dell'IVA nel carrello</span><span class="meta">unita</span></div>
      <div class="item">${ic("message-circle", "lead")}<span class="grow truncate">Stima di S3 con Paolo e Marco</span><span class="meta">decisa</span></div>
    </div>
    <div class="section">
      <div class="closed-sec">${ic("chevron-right", "s14")}Perché è nella squadra</div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Copia di lavoro · trama/elena-s2</div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Colore</div>
    </div>
  </div>`;
}

function viewLavoro() {
  return `
  <div class="view">
    <div class="summary">
      <div class="row">${btn({ icon: "target", text: PROJECT.goal, size: "xs" })}<span class="grow"></span></div>
      <div class="row"><span class="grow">3 di 6 esempi dell'obiettivo provati</span><span class="sm muted">50%</span></div>
      <div class="progress"><span style="width:50%"></span></div>
    </div>
    <div class="section">
      <div class="sec-head">Fette · sprint «Spedizioni e pagamenti»</div>
      <div class="item">${avatar("elena")}<div class="col grow"><div class="truncate">S2 Spese di spedizione per zona</div><div class="meta">Elena · 3 di 5 esempi</div></div><span class="end"><span class="chip info">In corso</span></span></div>
      <div class="item">${avatar("paolo")}<div class="col grow"><div class="truncate">S3 Pagamento con PayPal</div><div class="meta">Paolo · aspetta il mandato</div></div><span class="end"><span class="chip warn">Ferma</span></span></div>
      <div class="item">${avatar("luca")}<div class="col grow"><div class="truncate">S1b Soglie di spedizione gratuita</div><div class="meta">Luca · verifiche 5 di 6</div></div><span class="end"><span class="chip">In verifica</span></span></div>
      <div class="item">${ic("circle-dashed", "lead")}<div class="col grow"><div class="truncate">S4 Pagina di stato dell'ordine</div><div class="meta">Nel backlog</div></div><span class="end"><span class="chip">Da iniziare</span></span></div>
      <div class="item">${ic("circle-check", "lead")}<div class="col grow"><div class="truncate">S1 Matrice delle taglie</div><div class="meta">Elena · ieri</div></div><span class="end"><span class="chip ok">Unita</span></span></div>
    </div>
    <div class="section">
      <div class="sec-head">Branch e pull request</div>
      <div class="item">${ic("git-branch", "lead")}<div class="col grow"><div class="truncate">${PROJECT.branch}</div><div class="meta">13 commit avanti, 7 indietro rispetto a main · il Coordinatore riallinea</div></div><span class="end"><span class="chip warn">18 conflitti</span>${btn({ icon: "chevron-down", title: "Mostra i 18 file", size: "icon-xs" })}</span></div>
      <div class="item">${ic("git-pull-request", "lead")}<div class="col grow"><div class="truncate">#42 Spese di spedizione per zona</div><div class="meta">Bozza · da S2 · CI in corso</div></div><span class="end">${btn({ icon: "external-link", title: "Apri su GitHub", size: "icon-xs" })}</span></div>
    </div>
    <div class="section">
      <div class="sec-head">Issue · 20 aperte<span class="end">${btn({ icon: "plus", title: "Nuova issue", size: "icon-xs" })}</span></div>
      <div class="item">${ic("circle-dot", "lead")}<div class="col grow"><div class="truncate">#21 Il totale del carrello ignora lo sconto</div><div class="meta">Trovata da Trama · nel backlog</div></div></div>
      <div class="item">${ic("circle-dot", "lead")}<div class="col grow"><div class="truncate">#19 Traduzione della pagina resi</div><div class="meta">In S4</div></div></div>
      <div class="item">${ic("circle-dot", "lead")}<div class="col grow"><div class="truncate">#17 Immagini lente nel catalogo</div><div class="meta">Squadra Catalogo · nessun lavoro</div></div></div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Altre 17</div>
    </div>
  </div>`;
}

function mandateSection() {
  return `
    <div class="section">
      <div class="sec-head"><b style="color:var(--foreground);font-weight:500">Mandato v2</b> · concesso il 26 settembre</div>
      <dl class="kv" style="padding:2px 8px 8px">
        <dt>Dove</dt><dd>checkout, catalogo (2 moduli su 9)</dd>
        <dt>Può</dt><dd>branch, commit, test, issue, unire con il via libera</dd>
        <dt>Mai</dt><dd>force push, push su main, cancellare branch o tag, rilasci, segreti</dd>
      </dl>
      <div class="item">${ic("hourglass", "lead")}<span class="grow truncate">La proposta v3 aspetta te</span><span class="end">${ic("chevron-right", "s14")}</span></div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Moduli · 9</div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Cambia il mandato: restringi, correggi, revoca</div>
      <div class="closed-sec">${ic("chevron-right", "s14")}Versioni precedenti · 1</div>
    </div>`;
}
function pactSection() {
  return `
    <div class="section">
      <div class="sec-head"><b style="color:var(--foreground);font-weight:500">Patto</b> · 3 decisioni in vigore<span class="end">${btn({ icon: "plus", title: "Nuova decisione", size: "icon-xs" })}</span></div>
      <div class="item">${ic("rosette-discount-check", "lead")}<span class="grow truncate">I prezzi si mostrano IVA inclusa</span><span class="xs faint">v2</span></div>
      <div class="item">${ic("rosette-discount-check", "lead")}<span class="grow truncate">Spedizione gratuita sopra 49 €</span><span class="xs faint">v1</span></div>
      <div class="item">${ic("rosette-discount-check", "lead")}<span class="grow truncate">Il ritiro in negozio non costa niente</span><span class="xs faint">v1</span></div>
    </div>`;
}
function standardSection() {
  const rule = (text, on = true) => `<div class="item"><span class="grow truncate">${text}</span><span class="toggle${on ? " on" : ""}"></span></div>`;
  return `
    <div class="section">
      <div class="sec-head"><b style="color:var(--foreground);font-weight:500">Standard del codice</b> · 7 regole attive su 8</div>
      ${rule("Funzioni brevi, un solo compito")}
      ${rule("Nomi che spiegano l'intento")}
      ${rule("Test prima del codice")}
      ${rule("Commenti solo sul perché", false)}
      <div class="closed-sec">${ic("chevron-right", "s14")}Altre 4 regole</div>
    </div>`;
}

/** Rules: "stack" puts the three parts in one scroll, "tabs" splits them, "pact" keeps the standard in Settings. */
function viewRegole(mode = "stack") {
  const summary = `<div class="summary"><div class="lead">Cosa vale in questo progetto</div><div class="sm muted">Cosa può fare il Coordinatore, le decisioni di prodotto e lo standard del codice.</div></div>`;
  if (mode === "tabs") {
    return `<div class="view">
      <div class="summary"><div class="seg"><button class="on">Mandato</button><button>Patto · 3</button><button>Standard</button></div></div>
      ${mandateSection()}
    </div>`;
  }
  if (mode === "pact") {
    return `<div class="view">
      <div class="summary"><div class="lead">Cosa vale in questo progetto</div><div class="sm muted">Cosa può fare il Coordinatore e le decisioni di prodotto.</div></div>
      ${mandateSection()}${pactSection()}
      <div class="section"><div class="item">${ic("settings", "lead")}<span class="grow truncate muted">Standard del codice: nelle impostazioni del progetto</span>${ic("chevron-right", "s14")}</div></div>
    </div>`;
  }
  return `<div class="view">${summary}${mandateSection()}${pactSection()}${standardSection()}</div>`;
}

function viewMemoria() {
  const note = (text) => `<div class="item tall"><span class="grow sm">${text}</span><span class="end">${btn({ icon: "pencil", title: "Modifica", size: "icon-xs" })}</span></div>`;
  return `
  <div class="view">
    <div class="summary">
      <div class="lead">Cosa ricorda il Coordinatore</div>
      <div class="item" style="margin:0 -8px">${ic("hourglass", "lead")}<span class="grow truncate">1 proposta aspetta te: prezzi IVA inclusa</span><span class="end">${ic("chevron-right", "s14")}</span></div>
    </div>
    <div class="section">
      <div class="sec-head">Note sul progetto · 3<span class="end">${btn({ icon: "plus", title: "Aggiungi una nota", size: "icon-xs" })}</span></div>
      ${note("Shopify serve solo per il catalogo; ordini e pagamenti sono nel nostro backend.")}
      ${note("Le spedizioni verso le isole minori costano 5 € in più.")}
      ${note("I test end-to-end del carrello girano con Playwright.")}
    </div>
    <div class="section">
      <div class="sec-head">Il tuo profilo · 2<span class="end">${btn({ icon: "plus", title: "Aggiungi al profilo", size: "icon-xs" })}</span></div>
      ${note("Preferisci risposte brevi, con i numeri.")}
      ${note("I testi dell'interfaccia li decidi tu; il Coordinatore propone.")}
    </div>
    <div class="section">
      <div class="sec-head">Skill apprese · 1</div>
      <div class="item">${ic("file-text", "lead")}<div class="col grow"><div class="truncate">Test degli endpoint di Shopify</div><div class="meta">Usata 4 volte</div></div><span class="end">${btn({ icon: "file-text", title: "Apri", size: "icon-xs" })}${btn({ icon: "lock", title: "Fissa", size: "icon-xs" })}${btn({ icon: "archive", title: "Archivia", size: "icon-xs" })}</span></div>
    </div>
    <div class="section">
      <div class="sec-head">Pratiche · 1</div>
      <div class="item tall"><span class="grow sm">La squadra Checkout scrive prima i test delle soglie<div class="meta">Dalla retrospettiva del 27 settembre</div></span></div>
    </div>
    <div class="section"><div class="closed-sec">${ic("chevron-right", "s14")}Come impara · revisione ogni sera, ultima ieri alle 18:00<span class="grow"></span>${btn({ icon: "rotate-clockwise", title: "Rivedi ora", size: "icon-xs" })}</div></div>
  </div>`;
}

function viewAttivita() {
  const row = (time, who, text, extra = "") =>
    `<div class="item"><span class="xs faint" style="width:34px">${time}</span>${who}<span class="grow truncate sm">${text}</span>${extra}${btn({ icon: "message-circle", title: "Mostra nella chat", size: "icon-xs" })}</div>`;
  const coord = `<span class="avatar" style="--agent:var(--color-text-accent)">C</span>`;
  return `
    ${row("11:52", avatar("elena"), "Elena: test delle zone Europa passati, 4 di 4")}
    ${row("11:48", coord, "Coordinatore: avviato il riallineamento di chore/pre-apertura")}
    ${row("11:40", avatar("marco"), "Marco: stand-up della squadra Checkout")}
    ${row("11:31", coord, "Bug triage: issue #21 smistata come bug, priorità media")}
    ${row("11:12", avatar("luca"), "Luca: verifica rossa, soglia di 49 € arrotondata male", `<span class="warn">${ic("alert-triangle", "s14")}</span>`)}
    ${row("10:05", coord, "Coordinatore: S2 assegnata a Elena")}`;
}

const PROJECTS = [
  { key: "n", name: "negozio", branch: "chore/pre-apertura", now: STATUS_TEXT, waiting: "Proposta di mandato v3", count: 2, working: true },
  { key: "t", name: "trama", branch: "main", now: "Verifico S5, poi assegno S6", waiting: null, count: 0, working: true },
  { key: "b", name: "blog-ricette", branch: "main", now: "Nessun lavoro aperto", waiting: null, count: 0, working: false },
];

function viewPanoramica() {
  return `
  <div style="max-width:760px;margin:0 auto;padding:24px 28px">
    <div class="row" style="margin-bottom:6px"><h2 style="margin:0;font-size:18px;font-weight:600" class="grow">Progetti</h2></div>
    <div class="sm muted" style="margin-bottom:16px">Prima i progetti dove qualcosa aspetta te. Lo stesso conteggio di Aspetta te.</div>
    ${PROJECTS.map(
      (p) => `
      <div class="proj">
        <span class="project-tile" style="width:34px;height:34px">${p.key}</span>
        <div class="col" style="gap:3px">
          <div class="row"><b style="font-weight:600">${p.name}</b><span class="xs faint">${p.branch}</span></div>
          <div class="row sm muted">${p.working ? `<span class="spinner"></span>` : `<span class="dot idle"></span>`}<span class="truncate">${p.now}</span></div>
        </div>
        <div class="row sm">${p.count ? `<span class="accent">${ic("hourglass", "s14")}</span><span class="truncate" style="max-width:200px">${p.waiting}</span><span class="badge">${p.count}</span>` : `<span class="muted">Niente aspetta te</span>`}</div>
      </div>`,
    ).join("")}
  </div>`;
}

const PROVIDERS = [
  { name: "ChatGPT", sub: "Codex, account principale", color: "#0d0d0d", state: `<span class="chip warn">Quota esaurita fino alle 13:47</span>` },
  { name: "GitHub", sub: "emanueledenaro · repository privato", color: "#24292f", state: `<span class="chip ok">Collegato</span>` },
  { name: "Claude", sub: "Claude Code", color: "#c96442", state: `<span class="chip ok">Collegato</span>` },
  { name: "Cursor", sub: "Agente di Cursor", color: "#26251e", state: `<span class="chip">Non installato</span>` },
  { name: "Antigravity", sub: "Solo lettura", color: "#3186ff", state: `<span class="chip ok">Collegato</span>` },
  { name: "Grok", sub: "", color: "#000000", state: `<span class="chip">Non collegato</span>`, login: true },
  { name: "Droid", sub: "", color: "#d15010", state: `<span class="chip">Non installato</span>` },
  { name: "Devin", sub: "", color: "#00a558", state: `<span class="chip">Non collegato</span>`, login: true },
  { name: "OpenCode", sub: "", color: "#211e1e", state: `<span class="chip ok">Collegato</span>` },
];

/** Settings: app sections first, then the open project's. `withStandard` adds the code standard (alternative C). */
function viewImpostazioni({ withStandard = false } = {}) {
  const nav = (icon, text, on = false) => `<div class="nav-row${on ? " on" : ""}">${ic(icon)}<span class="truncate">${text}</span></div>`;
  return `
  <div class="app" style="height:100%;width:100%">
    <div class="settings-nav">
      <div class="nav-head">App</div>
      ${nav("settings", "Generale")}
      ${nav("plug-connected", "Collegamenti", true)}
      <div class="nav-head">Progetto negozio</div>
      ${nav("tools", "Metodo di lavoro")}
      ${withStandard ? nav("checklist", "Standard del codice") : ""}
      ${nav("eye", "Monitor")}
      ${nav("users", "Presenza")}
    </div>
    <div class="scroll"><div class="settings-body">
      <div class="row"><h1 class="grow">Collegamenti</h1>${btn({ icon: "refresh", text: "Verifica tutti", variant: "outline" })}</div>
      <div class="sm muted">Con quale account lavorano il Coordinatore e le squadre. Le credenziali restano nei componenti ufficiali.</div>
      <div class="card" style="padding:4px 6px">
        ${PROVIDERS.map(
          (p) => `
          <div class="prov">
            <span class="prov-mark" style="background:${p.color}">${p.name[0]}</span>
            <div class="col"><span>${p.name}</span>${p.sub ? `<span class="xs muted">${p.sub}</span>` : ""}</div>
            <div class="row">${p.state}</div>
            <div class="row" style="gap:2px">${p.login ? btn({ text: "Accedi", variant: "outline", size: "xs" }) : ""}${btn({ icon: "list-details", title: `Capacità di ${p.name}`, size: "icon-xs" })}${btn({ icon: "refresh", title: `Verifica ${p.name}`, size: "icon-xs" })}</div>
          </div>`,
        ).join("")}
      </div>
    </div></div>
  </div>`;
}

/** The view shown for a state, by name. */
function viewFor(state, opts = {}) {
  switch (state) {
    case "aspetta":
      return viewAspetta();
    case "squadre":
      return viewSquadre();
    case "specialista":
      return viewSpecialista(opts);
    case "lavoro":
      return viewLavoro();
    case "regole":
      return viewRegole(opts.rules);
    case "memoria":
      return viewMemoria();
    default:
      return "";
  }
}
const VIEW_TITLES = { aspetta: "Aspetta te", squadre: "Squadre", specialista: "Squadre", lavoro: "Lavoro", regole: "Regole", memoria: "Memoria" };
const VIEW_ICONS = { aspetta: "hourglass", lavoro: "file-diff", squadre: "users-group", regole: "shield-check", memoria: "brain" };

// --- Boot ---------------------------------------------------------------------------------------------------

function boot(render) {
  const root = document.documentElement;
  root.dataset.provider = "codex";
  root.classList.toggle("dark", THEME === "scuro");
  if (params.has("scatto")) root.dataset.scatto = "1";
  document.getElementById("app").innerHTML = render(STATE, { width: innerWidth, height: innerHeight });
  // The chat opens on its latest messages, as in the app.
  for (const el of document.querySelectorAll("[data-misura='conversazione']")) el.scrollTop = el.scrollHeight;
  const file = location.pathname.split("/").pop();
  const nav = document.createElement("nav");
  nav.className = "proto-nav";
  nav.innerHTML =
    STATES.map((s) => `<a href="${file}?vista=${s}&tema=${THEME}" class="${s === STATE ? "on" : ""}">${STATE_LABELS[s]}</a>`).join("") +
    `<a href="${file}?vista=${STATE}&tema=${THEME === "scuro" ? "chiaro" : "scuro"}">${THEME === "scuro" ? "Chiaro" : "Scuro"}</a>`;
  document.body.appendChild(nav);
  root.dataset.pronto = "1";
}
