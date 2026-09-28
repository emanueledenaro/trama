// Alternative C, "Chat e pannello a schede": no sidebar. The top bar says where the person is and what happens
// now; the chat fills the window; one panel on the right has five tabs. Projects and Settings are full pages.
// Rules join Mandate and Pact; the code standard stays in the project's settings.
function renderC(state, { width }) {
  const wide = width >= 1500;
  const panelW = wide ? 520 : 440;
  // At the default width only the open tab shows its name; the others are icons with a tooltip.
  const compactTabs = !wide;
  const panelOpen = !["principale", "panoramica", "impostazioni"].includes(state);
  const tabKey = state === "specialista" ? "squadre" : state;

  if (state === "panoramica" || state === "impostazioni") {
    const isP = state === "panoramica";
    return `
    <div class="app" style="flex-direction:column">
      <div class="bar" style="gap:4px;padding-left:12px">
        ${btn({ icon: "arrow-left", title: "Torna a negozio" })}
        <h2 class="grow" style="margin-left:4px">${isP ? "Progetti" : "Impostazioni"}</h2>
        ${isP ? btn({ icon: "folder-plus", title: "Apri un progetto" }) : ""}
        ${btn({ icon: isP ? "settings" : "layout-list", title: isP ? "Impostazioni" : "Progetti" })}
      </div>
      ${isP ? `<div class="scroll">${viewPanoramica()}</div>` : `<div class="col grow" style="min-height:0">${viewImpostazioni({ withStandard: true })}</div>`}
    </div>`;
  }

  const topBar = `
  <div class="bar" style="padding-left:12px;gap:6px">
    ${btn({ icon: "chevron-down", text: "negozio", size: "sm" })}
    <span class="sm faint row" style="gap:4px;flex-shrink:0">${ic("git-branch", "s14")}${PROJECT.branch}</span>
    <span style="width:1px;height:16px;background:var(--border);margin:0 6px"></span>
    <span class="spinner"></span>
    <span class="sm truncate grow">${STATUS_TEXT}</span>
    ${btn({ icon: "list-details", title: "Attività" })}
    ${btn({ icon: "player-pause", title: "Pausa del Coordinatore" })}
    ${btn({ icon: "layout-sidebar-right", title: "Pannello", on: panelOpen })}
  </div>`;

  const ptab = (key, label, badge = null) => {
    const on = tabKey === key;
    const text = compactTabs && !on ? "" : label;
    return `<button type="button" role="tab" class="ptab${on ? " on" : ""}" title="${label}" aria-label="${label}">${ic(VIEW_ICONS[key], "s14")}${text}${badge ? `<span class="badge">${badge}</span>` : ""}</button>`;
  };
  const panel = panelOpen
    ? `
  <aside class="pane inspector" style="--inspector-w:${panelW}px">
    <div class="sash sash--vertical" role="separator" aria-orientation="vertical"></div>
    <div class="ptabs" role="tablist">
      ${ptab("aspetta", "Aspetta te", 2)}${ptab("lavoro", "Lavoro")}${ptab("squadre", "Squadre")}${ptab("regole", "Regole")}${ptab("memoria", "Memoria")}
    </div>
    <div class="scroll">${viewFor(state, { rules: "pact" })}</div>
  </aside>`
    : "";

  return `
  <div class="app">
    <main class="pane main">${topBar}${conversation({ showWaiting: state !== "aspetta" })}</main>
    ${panel}
  </div>`;
}
