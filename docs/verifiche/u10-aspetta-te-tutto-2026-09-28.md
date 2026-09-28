# U10: "Aspetta te" conta tutto ciò che aspetta la persona

Data: 28 settembre 2026. Issue #292, dopo #283 (issue #240). Base finale: `origin/main` e1ca179, con #291.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

Sul branch unito a `origin/main` e1ca179:

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 120 file, 1172 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: uscita 0, 304 schermate.

Le schermate prima e dopo vengono da due corse complete del ui-check (uscita 0, 288 schermate ciascuna) sulla base f22ca3f e sul branch prima dell'unione con #291, con le stesse schermate nuove aggiunte in entrambe per il confronto.

## Comportamento

- Entrano in "Aspetta te" anche:
  - gli obiettivi proposti dal Coordinatore e non ancora confermati, non archiviati ("Obiettivo proposto", non ferma il lavoro);
  - la proposta di condividere la presenza in attesa di risposta ("Presenza", non ferma il lavoro);
  - i percorsi di Ask Trama proposti e non ancora avviati o rifiutati ("Percorso di Ask Trama", ferma il lavoro della richiesta);
  - i candidati verificati, senza pull request, che la persona non ha ancora approvato o la cui approvazione non vale più ("Candidato da guardare", ferma 1 parte del lavoro).
- Restano le voci di prima: domande, mandato (anche la proposta di mandato di progetto di #291), team, seam e fette del piano, proposte della Memoria e azioni fermate dai divieti fissi. L'ordinamento è lo stesso per tutte: prima quanto lavoro ferma, poi la più vecchia.
- Un solo punto nel codice decide cosa aspetta la persona: `waitingForYou` in `app/src/shared/waitingForYou.ts`. Il processo principale calcola la lista una volta a ogni aggiornamento (`project.waiting`). Il riepilogo sopra il composer, il contatore nella barra laterale, il pulsante del prossimo passo e i riferimenti in chat leggono quella lista. Il riepilogo del Coordinatore usa la stessa funzione con le stesse fonti.
- In chat la scheda che aspetta lascia il riferimento "Apri in Aspetta te", come per le voci di #283. Con la risposta la scheda torna intera nella cronologia.

## Test

- `app/src/shared/waitingForYou.test.ts`: obiettivi proposti (non quelli aperti o archiviati), proposta di presenza, percorsi proposti (non quelli rifiutati), candidati da guardare (non quelli in costruzione, già approvati o pubblicati; sì quelli con approvazione non più valida); un solo ordinamento per tutti i tipi; ogni voce esce quando la persona risponde.
- `app/src/main/controller.test.ts`: il test dei divieti fissi di #291 conta solo le voci delle azioni vietate, perché ora aspetta anche l'obiettivo proposto dallo studio.
- `ui-check`: all'apertura del progetto di esempio l'obiettivo proposto è la sola voce, nel riepilogo, nel contatore e come riferimento in chat. Nel progetto dei candidati, scartato l'obiettivo proposto, il riepilogo sparisce. Candidato, obiettivo, percorso e presenza si aprono e si usano da "Aspetta te"; dopo la risposta la scheda torna in chat. Nei passi A04 di #291 il controllo guarda la voce del mandato e quella del divieto, non il riepilogo intero. Schermate nuove: `04f2-waiting-candidate`, `10b-waiting-proposed-goal`, `16a-waiting-presence`, in chiaro e scuro.

## Schermate

Prima (base f22ca3f) e dopo, stessi passi del ui-check, in `u10-aspetta-te-tutto/`:

- Obiettivo proposto: `01-prima-obiettivo-chiaro.png`, `02-prima-obiettivo-scuro.png`, `03-dopo-obiettivo-chiaro.png`, `04-dopo-obiettivo-scuro.png`. Prima 2 voci, dopo 3 con l'obiettivo.
- Consenso alla presenza: `05` a `08`. Prima la scheda in chat e nessuna voce; dopo 2 voci, obiettivo e presenza, con "Non ora" e "Condividi" a destra.
- Candidato da guardare: `09` a `12`. Prima la scheda in chat; dopo il riferimento in chat e la scheda in "Aspetta te".
- Percorso di Ask Trama: `13` a `16`.

## Limiti

- Trama oggi non distingue i candidati che cambiano l'interfaccia: ogni candidato verificato chiede l'approvazione della persona prima della pubblicazione, quindi tutti entrano in "Aspetta te". Le schermate prima e dopo sulla scheda del candidato arriveranno con quella distinzione.
