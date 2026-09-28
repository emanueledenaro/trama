# B08: Attività nel pannello in basso (28 settembre 2026)

Verifiche eseguite su Linux, in un container senza Codex reale e senza `gh`, sul branch `feature/issue-337-b08-bottom-panel-bmwnr9` con `origin/main` a `9f31105` unito (B01, PR #350, è su main). Le schermate vengono da `scripts/ui-check.mjs` con l'app-server Codex di prova. Le schermate "prima" vengono dallo stesso ui-check eseguito su `main` a `9f31105`, fermato dopo l'apertura dei passi di un turno.

## Cosa è stato provato

- Test di unità: `renderer/lib/activityPanel.test.ts` (elenco unico in ordine di tempo con mosse, giri, problemi, passi fatti per la persona, unioni e turni; turni senza passi esclusi; filtri per chi e per tipo; riepilogo con cosa succede ora e l'ultima cosa andata male; la riga chiesta dalla chat resta visibile oltre la prima pagina), `renderer/lib/workbench.test.ts` (Attività non è più una scheda della barra laterale; altezza del pannello 200 px, 260 px con la finestra larga, e altezza massima che lascia l'editor sopra).
- ui-check: con il pannello aperto a 1280x800 la conversazione resta alta 384 px (sopra i 380 chiesti); il pannello sta sotto l'editor, largo quanto l'editor, e non copre la barra di stato; 200 px a 1280x800 e 260 px a 1680x1050; niente scorrimento orizzontale; temi Codex e Claude in chiaro e in scuro, finestra stretta e larga. Le righe stanno su una riga, gli id non compaiono nel testo, "Mostra nella chat" è un'icona e porta in vista la riga della chat. Il filtro per tipo tiene solo i turni di lavoro; il filtro per persona sceglie il Coordinatore. Il separatore orizzontale trascinato in basso porta il pannello a 160 px, freccia su lo alza di 16 px, trascinato in alto si ferma all'altezza massima con la conversazione ancora a 380 px o più, Home lo riporta a 200 px. L'interruttore della barra del titolo chiude e apre il pannello, la X lo chiude, l'icona Attività della barra di stato lo apre.
- Passi spostati nel pannello: `04-work-expanded`, `15b-activity`, `15b1-activity-step-correct` (Correggi, Annulla e Invia la correzione come prima), `18a-specialist-stopped`, `18a4-activity-tool-errors` (gli strumenti non riusciti stanno nel dettaglio della riga), `24c`/`24d`, `27a-found-problem-issue`, `28d-reopened-turn-resumed`, `29b-activity-steps`, `30a-ticket-partial`, `30b-ticket-failed`, `30a-merge-activity`, `30e-merge-activity-person`. Il backlog dei problemi trovati (`27c-found-problem-local-backlog`) si controlla nel filtro "Nel backlog" di Lavoro, Issue; il collegamento "backlog di Trama" di un rilievo dell'Esame approfondito (F04) apre lo stesso filtro. Il controllo di #397 sugli id grezzi in Attività passa nel pannello.

## Non verificato

- Il trascinamento del separatore su macOS e Windows: le prove girano su Linux con xvfb.
- Mosse automatiche reali di Codex: le mosse vengono dall'app-server di prova.

## Schermate

Prima: Attività come scheda di Lavoro nella barra laterale (main con B01), 1280x800 e 1680x1050.

![Prima, Codex chiaro, 1280x800](b08-pannello-in-basso/prima-1280x800-codex-chiaro.png)
![Prima, Codex scuro, 1280x800](b08-pannello-in-basso/prima-1280x800-codex-scuro.png)
![Prima, Claude chiaro, 1280x800](b08-pannello-in-basso/prima-1280x800-claude-chiaro.png)
![Prima, Claude scuro, 1280x800](b08-pannello-in-basso/prima-1280x800-claude-scuro.png)
![Prima, Codex chiaro, 1680x1050](b08-pannello-in-basso/prima-1680x1050-codex-chiaro.png)
![Prima, Codex scuro, 1680x1050](b08-pannello-in-basso/prima-1680x1050-codex-scuro.png)
![Prima, Claude chiaro, 1680x1050](b08-pannello-in-basso/prima-1680x1050-claude-chiaro.png)
![Prima, Claude scuro, 1680x1050](b08-pannello-in-basso/prima-1680x1050-claude-scuro.png)

Dopo: Attività nel pannello in basso, stesse finestre.

![Dopo, Codex chiaro, 1280x800](b08-pannello-in-basso/dopo-1280x800-codex-chiaro.png)
![Dopo, Codex scuro, 1280x800](b08-pannello-in-basso/dopo-1280x800-codex-scuro.png)
![Dopo, Claude chiaro, 1280x800](b08-pannello-in-basso/dopo-1280x800-claude-chiaro.png)
![Dopo, Claude scuro, 1280x800](b08-pannello-in-basso/dopo-1280x800-claude-scuro.png)
![Dopo, Codex chiaro, 1680x1050](b08-pannello-in-basso/dopo-1680x1050-codex-chiaro.png)
![Dopo, Codex scuro, 1680x1050](b08-pannello-in-basso/dopo-1680x1050-codex-scuro.png)
![Dopo, Claude chiaro, 1680x1050](b08-pannello-in-basso/dopo-1680x1050-claude-chiaro.png)
![Dopo, Claude scuro, 1680x1050](b08-pannello-in-basso/dopo-1680x1050-claude-scuro.png)

Separatore orizzontale trascinato:

![Separatore trascinato](b08-pannello-in-basso/separatore-trascinato.png)

Correzione di un passo del Coordinatore, come prima, dalla riga di Attività:

![Correggi un passo](b08-pannello-in-basso/correggi-passo.png)

Strumenti non riusciti nel dettaglio della riga:

![Strumenti non riusciti](b08-pannello-in-basso/strumenti-non-riusciti-scuro.png)

Backlog dei problemi trovati nel filtro "Nel backlog" delle issue:

![Nel backlog](b08-pannello-in-basso/nel-backlog.png)
