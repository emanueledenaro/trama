# Temi dei provider

Regola del 29 settembre 2026 (issue #457): lo sfondo è uno solo per tutti i provider, bianco in chiaro e scuro in scuro, con l'effetto vetro (vibrancy su macOS, Acrylic su Windows, fondo opaco sugli altri sistemi). Il provider del dialogo cambia solo gli accenti.

L'attributo `data-provider` sulla radice (impostato da `useProviderTheme` in `app/src/renderer/App.tsx`) sceglie in `app/src/renderer/index.css` questi token, in versione chiara e scura:

- `--color-text-accent`: testo d'accento, link, badge informativi, anello del contesto, separatore acceso (`--app-focus-border`) e selezione del testo;
- `--primary` e `--primary-foreground`: il pulsante principale, dentro la regola del pulsante pieno (B09, `FilledScope`);
- `--ring`: l'anello di focus;
- `--sidebar-selected`: la selezione nella barra laterale;
- `--app-user-message-background`: il fumetto dei messaggi della persona;
- `--provider-light`: la luce del provider, solo sul simbolo di Trama (B01), sulle schede di decisione e sulla scheda consigliata di un confronto.

Il provider non tocca `--surface`, `--ink`, le tinte delle sezioni e `--glass-light`, la luce neutra sul vetro. I colori di stato (errori, avvisi, successo) restano uguali per tutti i provider. `app/src/renderer/lib/providerTheme.test.ts` verifica che i blocchi dei provider dichiarino solo gli accenti, e ui-check confronta lo sfondo calcolato di ogni sezione con i nove provider.

Gli accenti vengono dai siti ufficiali, letti il 25 settembre 2026 con gli stili calcolati della pagina o le variabili del tema. La colonna delle superfici resta come riferimento del marchio: Trama non la usa più per lo sfondo.

| Provider | Superfici chiaro / scuro | Accento del marchio | Fonte |
| --- | --- | --- | --- |
| ChatGPT | `#ffffff` / `#212121`, grigi neutri | blu `#339cff` (oklch 0.72 0.15 248) | chatgpt.com |
| Claude | avorio `#faf9f5` / `#262624`, testo `#141413` | terracotta `#d97757` | anthropic.com |
| Cursor | `#f7f7f4` / `#14120b`, testo `#26251e` | arancio `#f54e00` (`--color-theme-accent`) | cursor.com |
| Antigravity | `#f8f9fc` / `#121317` | blu `#3186ff`, con `#00b95c`, `#fc413d`, `#ffe432` | antigravity.google |
| Grok | `#f9f8f7` / `#1e1f22` (`theme-color`) | monocromatico | grok.com |
| Droid (Factory) | `#f5f5f5` / `#0d0d0d` | arancio `#d15010` | factory.ai |
| Devin | `#fcfcfc` / `#131313`, testo `#191919` | blu `#317cff` (`--text-accent-primary`), verde `#00a558` | devin.ai |
| OpenCode | `#f1f0f0` / `#181616`, carbone `#211e1e` | grigi `#bcbbbb`, verde `#03b000` | opencode.ai |
| Pi | `#f3f2f0` / `#161d27` (`--bg-canvas`) | azzurro `#6a9fcc`, blu marea `#4b607c` | pi.dev |

Gli accenti usati per il testo sono una tonalità più scura del colore del marchio in modalità chiara e più chiara in modalità scura, per restare leggibili. La luce del provider di Grok, ChatGPT e OpenCode è grigia perché i loro marchi sono monocromatici.

## Superficie e sezioni

| Token | Chiaro | Scuro |
| --- | --- | --- |
| `--surface` | `#FFFFFF` | `#212121` |
| `--ink` | `#0D0D0D` | `#ECECEC` |
| `--app-editor-tint` (area dell'editor) | `#FFFFFF` | `#212121` |
| `--app-panel-tint` (pannello in basso) | `#FAFAFA` | `#1D1D1D` |
| `--app-sidebar-tint` (barra laterale, striscia delle schede, ispettore) | `#F7F7F7` | `#1A1A1A` |
| `--app-activitybar-tint` (barra delle attività e barra del titolo) | `#F2F2F2` | `#171717` |
| `--app-statusbar-tint` (barra di stato) | `#EEEEEE` | `#141414` |
| `--glass-light` (luce sul vetro) | `#8E8EA0` | `#FFFFFF` |

Ogni sezione ha una tinta neutra leggermente diversa, così le sezioni si distinguono senza linee in più. Sugli altri sistemi le tinte sono opache (`--app-*-surface` vale la tinta). Su macOS e Windows la finestra è vetro: editor e pannello in basso usano la loro tinta all'80% (78% in scuro) con il 7% della luce neutra, le barre la loro tinta al 55% (60% in scuro); il velo sul vetro è la luce neutra al 18% (32% in scuro).

## Pannelli e separatori

I pannelli seguono la disposizione di Visual Studio Code (temi predefiniti Light Modern e Dark Modern): barra laterale, editor e pannello in basso sono attaccati e occupano tutta l'altezza, separati da un bordo di 1 px. Le tinte della tabella sopra stanno vicino a quelle di VS Code (`sideBar.background` `#F8F8F8` / `#181818`, `editor.background` `#FFFFFF` / `#1F1F1F`).

| Token | Chiaro | Scuro | VS Code |
| --- | --- | --- | --- |
| `--app-panel-border` | superficie con 10% di nero, `#E6E6E6` | superficie con 5% di bianco, `#2C2C2C` | `sideBar.border`, `panel.border` `#E5E5E5` / `#2B2B2B` |
| `--app-focus-border` | accento del provider, `#0A6FD6` con Codex | accento del provider, `#5AAEFF` con Codex | `focusBorder` `#005FB8` / `#0078D4` |

Su macOS e Windows l'ispettore usa la superficie opaca, perché può galleggiare sopra la conversazione.

Tutti i separatori tra pannelli usano lo stesso componente `Sash` in `app/src/renderer/lib/resizable.tsx`, con lo stile `.sash` in `index.css`, sul modello di `sash.ts` e `sash.css` di VS Code. A riposo è trasparente: la linea è il bordo di 1 px del pannello. L'area da afferrare è larga 4 px, centrata sul bordo, sopra ai contenuti (z-index 35). Dopo 300 ms di hover, durante il trascinamento e con il focus da tastiera mostra una striscia di 4 px nel colore `--app-focus-border`, l'accento del provider, con una transizione di 0,1 s; con i colori forzati usa `Highlight`. Il cursore è `col-resize` o `row-resize` su macOS, `ew-resize` o `ns-resize` altrove, come in VS Code. Il doppio clic e il tasto Home riportano il pannello alla misura predefinita, le frecce la cambiano di 16 px (64 px con Maiusc) entro i limiti di `useResizableWidth`.
