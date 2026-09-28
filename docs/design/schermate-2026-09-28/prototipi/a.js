// Alternative A, "Albero del progetto": the sidebar lists the projects and, under the open one, its five views;
// the chat stays in the middle; the view opens in the inspector on the right. Closest to today's layout.
function renderA(state, { width }) {
  const wide = width >= 1500;
  const sidebarW = wide ? 256 : 240;
  const inspectorW = wide ? 480 : 400;
  const inProject = !["panoramica", "impostazioni"].includes(state);
  const viewKey = state === "specialista" ? "squadre" : state;

  const sub = (key, text, badge = null) =>
    `<div class="nav-row sub${viewKey === key ? " on" : ""}">${ic(VIEW_ICONS[key])}<span class="truncate">${text}</span>${badge ? `<span class="badge">${badge}</span>` : ""}</div>`;
  const sidebar = `
  <aside class="pane sidebar" style="--sidebar-w:${sidebarW}px">
    <div class="bar" style="gap:2px;padding-left:12px">
      ${btn({ icon: "layout-sidebar", title: "Nascondi la barra laterale" })}
      ${btn({ icon: "arrow-narrow-left", title: "Indietro" })}
      ${btn({ icon: "arrow-narrow-right", title: "Avanti" })}
    </div>
    <div class="row" style="padding:10px 12px 4px 16px"><span class="grow" style="font-size:17px;font-weight:600">Trama</span>${btn({ icon: "search", title: "Cerca", size: "icon-xs" })}${btn({ icon: "folder-plus", title: "Apri un progetto", size: "icon-xs" })}</div>
    <div class="nav scroll">
      <div class="nav-head">Progetti</div>
      <div class="nav-row${state === "panoramica" ? " on" : ""}">${ic("layout-list")}<span>Tutti i progetti</span></div>
      <div class="nav-row${state === "principale" ? " on" : ""}">${ic("folder-open")}<span class="truncate">negozio</span><span class="end xs faint">chat</span></div>
      ${sub("aspetta", "Aspetta te", 2)}
      ${sub("lavoro", "Lavoro")}
      ${sub("squadre", "Squadre")}
      ${sub("regole", "Regole")}
      ${sub("memoria", "Memoria")}
      <div class="nav-row">${ic("folder")}<span class="truncate">trama</span><span class="end"><span class="dot work" title="Al lavoro"></span></span></div>
      <div class="nav-row">${ic("folder")}<span class="truncate">blog-ricette</span></div>
    </div>
    <div class="nav" style="border-top:1px solid var(--app-surface-divider);padding:6px 8px 10px">
      <div class="nav-row${state === "impostazioni" ? " on" : ""}">${ic("settings")}<span>Impostazioni</span></div>
    </div>
  </aside>`;

  if (state === "panoramica" || state === "impostazioni") {
    const title = state === "panoramica" ? "Progetti" : "Impostazioni";
    const body = state === "panoramica" ? `<div class="scroll">${viewPanoramica()}</div>` : `<div class="col grow" style="min-height:0">${viewImpostazioni()}</div>`;
    return `<div class="app">${sidebar}<main class="pane main"><div class="bar"><h2 class="grow">${title}</h2></div>${body}</main></div>`;
  }

  const chat = `
  <main class="pane main">
    <div class="bar">
      <span class="muted">${ic("folder-open", "s14")}</span><h2>negozio</h2><span class="sm faint truncate">${PROJECT.branch}</span>
      <span class="grow"></span>
      ${btn({ icon: "refresh", title: "Aggiorna il progetto" })}
      ${btn({ icon: "layout-sidebar-right", title: "Mostra il pannello", on: inProject && state !== "principale" })}
    </div>
    ${statusLine()}
    ${conversation({ showWaiting: state !== "aspetta" })}
  </main>`;

  const inspector =
    state === "principale"
      ? ""
      : `
  <aside class="pane inspector" style="--inspector-w:${inspectorW}px">
    <div class="sash sash--vertical" role="separator" aria-orientation="vertical"></div>
    <div class="bar"><h2 class="grow">${VIEW_TITLES[state]}${state === "aspetta" ? ` <span class="muted">· 2</span>` : ""}</h2>${btn({ icon: "arrows-diagonal", title: "Allarga" })}${btn({ icon: "x", title: "Chiudi" })}</div>
    <div class="scroll">${viewFor(state, { rules: "stack" })}</div>
  </aside>`;

  return `<div class="app">${sidebar}${chat}${inspector}</div>`;
}
