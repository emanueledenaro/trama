# Tipografia editoriale: Newsreader, Inter e JetBrains Mono

Data: 28 settembre 2026. Issue #328. Base: `origin/main` d9d1e04.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 139 file, 1297 test superati, 3 saltati.
- `npm run build`: riuscito. `dist/assets` contiene i file `woff2` di Newsreader (normale e corsivo, asse `opsz`), Inter e JetBrains Mono; la CSP di `index.html` resta `font-src 'self' data:`.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 368 schermate.
- `node scripts/licenses/cli.mjs app/package-lock.json`: tutte le licenze ammesse (i font sono OFL-1.1).

## Comportamento

- Tre famiglie incluse nell'app con i pacchetti `@fontsource-variable`, importate una volta in `app/src/renderer/main.tsx`: niente richieste di rete all'avvio.
- Token in `app/src/renderer/index.css`: `--font-ui-family` (Inter), `--font-content-family` (Newsreader), `--font-mono-family` (JetBrains Mono), `--font-display-family` (Newsreader) e i token dei contenuti: dimensione 1.125rem, interlinea 1.68, spaziatura -0.01em, `opsz` 18.
- Contenuti in Newsreader: messaggi della chat (risposte del Coordinatore, bolle della persona, messaggi in coda), markdown nelle schede e nell'ispettore, messaggi tra agenti, risultato atteso di un obiettivo. Titoli h1, h2 e h3 dei contenuti a peso 500, interlinea 1.32.
- Interfaccia in Inter con le misure di prima: pulsanti, menu, input, composer, testate, barra laterale, etichette, badge, righe compatte della timeline.
- Codice inline e blocchi in JetBrains Mono.
- Restano sul token dell'interfaccia, perché dense: le tabelle nel markdown, le etichette dei riquadri e i badge dei confronti, le voci della memoria e l'anteprima del corpo di una pull request.

## Passo nuovo di ui-check

Dopo `16d-presence-coordinator` la persona scrive un messaggio con un titolo, codice inline e un blocco di codice. Il passo legge con `getComputedStyle` la famiglia di un messaggio del Coordinatore, del titolo, di un pulsante del composer e del blocco di codice, controlla dimensione, interlinea e `font-optical-sizing` del messaggio, peso e interlinea del titolo, e con `document.fonts.check` che i tre font siano caricati. Poi cerca testo che esce dalla chat o dal suo riquadro con tutti i temi dei provider, chiaro e scuro, e a 720x640. Schermate: `16d1-typography-codex-*`, `16d1-typography-claudeAgent-*` e `16d2-typography-narrow`.

## Schermate

La stessa schermata di ui-check (`17c-focus-*`) sulla base e su questo branch.

- Codex: `tipografia-editoriale/01-prima-codex-chiaro.png` e `01-dopo-codex-chiaro.png`, `02-prima-codex-scuro.png` e `02-dopo-codex-scuro.png`.
- Claude: `tipografia-editoriale/03-prima-claude-chiaro.png` e `03-dopo-claude-chiaro.png`, `04-prima-claude-scuro.png` e `04-dopo-claude-scuro.png`.
- Finestra stretta, 720x640: `tipografia-editoriale/05-dopo-finestra-stretta.png`.

## Limiti

- Le prove girano su Linux con Xvfb. Su macOS e Windows la resa dei font dipende dal sistema e non è stata guardata.
- Il controllo dei testi che escono dal riquadro guarda i messaggi della chat; le altre viste sono coperte dalle schermate di ui-check, non da un controllo automatico.
