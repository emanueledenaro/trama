// Alternative B, "Barra delle attività": like VS Code. An activity bar of icons on the left picks the view, which
// opens in a side bar; the chat is the editor area and a detail opens as a tab next to it (side by side when the
// window is wide); Activity is a bottom panel; what happens now is in the status bar at the bottom.
function renderB(state, { width }) {
  const wide = width >= 1500;
  const sideW = wide ? 340 : 300;
  const sideView = ["aspetta", "squadre", "specialista", "lavoro", "regole", "memoria"].includes(state);
  const activeAct = state === "specialista" ? "squadre" : state === "principale" ? "chat" : state;

  const act = (key, icon, title, badge = null) =>
    `<button type="button" class="act${activeAct === key ? " on" : ""}" title="${title}" aria-label="${title}">${ic(icon, "s20")}${badge ? `<span class="badge">${badge}</span>` : ""}</button>`;
  const activity = `
  <nav class="activity" aria-label="Viste">
    <button type="button" class="act${activeAct === "panoramica" ? " on" : ""}" title="Progetti" aria-label="Progetti"><span class="project-tile">n</span></button>
    <div style="height:6px"></div>
    ${act("chat", "message-circle", "Conversazione")}
    ${act("aspetta", "hourglass", "Aspetta te", 2)}
    ${act("lavoro", "file-diff", "Lavoro")}
    ${act("squadre", "users-group", "Squadre")}
    ${act("regole", "shield-check", "Regole")}
    ${act("memoria", "brain", "Memoria")}
    <span class="grow"></span>
    ${act("impostazioni", "settings", "Impostazioni")}
  </nav>`;

  const titleBar = `
  <div class="bar" style="padding-left:12px">
    ${btn({ text: "negozio", icon: null, size: "sm", variant: "ghost" })}
    <span class="sm faint row" style="gap:4px">${ic("git-branch", "s14")}${PROJECT.branch}</span>
    <span class="grow"></span>
    <div class="row sm muted" style="height:28px;width:min(360px,30vw);padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--color-background-button-secondary)">${ic("search", "s14")}<span class="grow truncate">Cerca in negozio</span><span class="kbd">⌘K</span></div>
    <span class="grow"></span>
    ${btn({ icon: "layout-sidebar", title: "Barra laterale", on: sideView })}
    ${btn({ icon: "layout-bottombar", title: "Pannello Attività", on: state === "squadre" })}
    ${btn({ icon: "layout-sidebar-right", title: "Dettaglio accanto alla chat", on: state === "specialista" && wide })}
  </div>`;

  const statusBar = `
  <footer class="statusbar">
    <span class="row">${ic("git-branch", "s12")}${PROJECT.branch}</span>
    <span class="row warn">${ic("alert-triangle", "s12")}18 conflitti</span>
    <span class="row grow truncate" style="color:var(--foreground)"><span class="spinner" style="width:10px;height:10px"></span><span class="truncate">${STATUS_TEXT}</span></span>
    <span class="row truncate" style="max-width:260px">${ic("target", "s12")}<span class="truncate">${PROJECT.goal}</span></span>
    ${btn({ icon: "list-details", title: "Attività", size: "icon-xs", on: state === "squadre" })}
    ${btn({ icon: "player-pause", title: "Pausa del Coordinatore", size: "icon-xs" })}
  </footer>`;

  const side = sideView
    ? `
  <aside class="pane sidebar" style="--sidebar-w:${sideW}px">
    <div class="bar" style="height:35px;padding-left:16px"><span class="xs muted grow" style="letter-spacing:.04em;text-transform:uppercase">${VIEW_TITLES[state]}${state === "aspetta" ? " · 2" : ""}</span>${btn({ icon: "arrows-diagonal", title: "Apri nell'editor", size: "icon-xs" })}</div>
    <div class="scroll">${state === "specialista" ? viewSquadre().replace('<div class="item">' + avatar("elena"), '<div class="item on">' + avatar("elena")) : viewFor(state, { rules: "tabs" })}</div>
    <div class="sash sash--vertical" role="separator" aria-orientation="vertical" style="left:auto;right:-2px"></div>
  </aside>`
    : "";

  // Editor area: tabs only when more than the conversation is open.
  const tab = (icon, text, on, closable = true) =>
    `<button type="button" role="tab" class="tab${on ? " on" : ""}">${ic(icon, "s14")}${text}${closable ? `<span class="faint" title="Chiudi" aria-hidden="true">${ic("x", "s12")}</span>` : ""}</button>`;
  let editor;
  if (state === "panoramica" || state === "impostazioni") {
    const isP = state === "panoramica";
    editor = `
      <div class="tabs" role="tablist">${tab("message-circle", "Conversazione", false, false)}${tab(isP ? "layout-list" : "settings", isP ? "Progetti" : "Impostazioni", true)}</div>
      ${isP ? `<div class="scroll">${viewPanoramica()}</div>` : `<div class="col grow" style="min-height:0">${viewImpostazioni()}</div>`}`;
  } else if (state === "specialista") {
    if (wide) {
      editor = `
      <div class="row grow" style="align-items:stretch;min-height:0;gap:0">
        <div class="pane grow"><div class="tabs" role="tablist">${tab("message-circle", "Conversazione", true, false)}</div>${conversation()}</div>
        <div class="pane" style="width:440px;border-left:1px solid var(--border)"><div class="sash sash--vertical" role="separator"></div><div class="tabs" role="tablist">${tab("users-group", "Elena", true)}</div><div class="scroll">${viewSpecialista({ back: false })}</div></div>
      </div>`;
    } else {
      editor = `
      <div class="tabs" role="tablist">${tab("message-circle", "Conversazione", false, false)}${tab("users-group", "Elena", true)}</div>
      <div class="scroll"><div style="max-width:640px">${viewSpecialista({ back: false })}</div></div>`;
    }
  } else {
    editor = conversation({ showWaiting: state !== "aspetta" });
  }

  const bottom =
    state === "squadre"
      ? `
    <div class="bottom-panel" style="height:${wide ? 260 : 200}px">
      <div class="sash sash--horizontal" role="separator" aria-orientation="horizontal"></div>
      <div class="row" style="height:32px;padding:0 8px 0 14px;border-bottom:1px solid var(--app-surface-divider)"><span class="xs" style="letter-spacing:.04em;text-transform:uppercase">Attività</span><span class="grow"></span>${btn({ text: "Tutti", size: "xs" })}${btn({ icon: "x", title: "Chiudi il pannello", size: "icon-xs" })}</div>
      <div class="scroll" style="padding:2px 8px">${viewAttivita()}</div>
    </div>`
      : "";

  return `
  <div class="app" style="flex-direction:column">
    <div class="row grow" style="align-items:stretch;min-height:0;gap:0">
      ${activity}
      <div class="pane grow">
        ${titleBar}
        <div class="row grow" style="align-items:stretch;min-height:0;gap:0">
          ${side}
          <main class="pane main">${editor}${bottom}</main>
        </div>
      </div>
    </div>
    ${statusBar}
  </div>`;
}
