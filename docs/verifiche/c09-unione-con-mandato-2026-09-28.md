# C09: unione dei candidati con il mandato, senza falsare la revisione umana

Data: 28 settembre 2026. Issue #41, ADR 0003. Base: `origin/main` 8bf9f4a.

## Cosa c'era già su main

- Il via libera del Coordinatore (`clear_candidate`) era registrato come "Coordinatore", separato dall'approvazione della persona, con un'impronta di snapshot, decisioni ed evidenze.
- La revisione tecnica rifiutava un revisore uguale all'autore. Il gate, le verifiche richieste e i conflitti bloccavano il candidato preciso.
- La pubblicazione della pull request richiedeva l'approvazione della persona e il mandato `openPullRequest`. Un nuovo tentativo riusava commit e pull request del primo.
- Mancava il merge: nessuno strumento del Coordinatore univa una pull request, e un merge interrotto da un timeout non veniva riconciliato.

## Cosa aggiunge questa modifica

- Strumento `integrate_candidate` del Coordinatore, entro il mandato `integrateCandidate` sui moduli del candidato. Trama unisce su GitHub la pull request che la persona ha pubblicato solo se tutte queste condizioni valgono sul candidato preciso:
  - via libera del Coordinatore dato con la versione del mandato in vigore. Un via libera più vecchio, o senza versione del mandato, chiede un nuovo via libera;
  - revisione tecnica approvata e distinta dall'autore;
  - verifiche richieste superate sullo snapshot, gate superato, decisioni invariate, nessun conflitto;
  - base su GitHub uguale a quella su cui il candidato è stato costruito;
  - testa della pull request uguale al commit che Trama ha spinto;
  - GitHub non trova conflitti e la CI è verde. Senza CI il Coordinatore non unisce.
- Una pull request pubblicata prima di questa modifica non ha il commit registrato: il Coordinatore non la unisce, serve un nuovo candidato con nuove verifiche.
- Trama rilegge pull request e base subito prima del merge. Se qualcosa è cambiato, il merge non parte. GitHub riceve anche il commit atteso e rifiuta il merge se nel frattempo qualcuno ha spinto sul branch.
- Casi distruttivi seri: modifica incompatibile, file cancellati, SQL che cancella dati. Il Coordinatore non li unisce. La voce "Unione fermata" va in "Aspetta te" con motivi, conseguenze e alternative, e resta sulla scheda del candidato dopo "Ho visto".
- Il record dell'unione (`candidate.integration`) porta attore "Coordinatore", versione del mandato, destinazione, stato e commit di merge. L'approvazione della persona non viene toccata.
- La destinazione viene salvata prima che la richiesta parta. Dopo un timeout lo stato resta "in corso" e il tentativo successivo, o l'aggiornamento da GitHub, legge la pull request: se è unita la registra, altrimenti il nuovo tentativo va alla stessa pull request con controlli nuovi. Nessun merge doppio.
- Pubblicazione, merge su GitHub, CI e distribuzione restano eventi distinti. La riga in Attività dice che la copia locale e l'app in uso non cambiano e che non parte nessuna distribuzione.

## Cosa è stato verificato

Tutte le prove usano il Codex finto e un GitHub finto nei test. Nessuna esecuzione reale di un provider e nessun merge reale su GitHub.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 136 file, 1296 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 355 schermate. Passi nuovi: `26a-merge-stopped` e `26b-merge-by-mandate`, in chiaro e in scuro.

## Test

- `app/src/main/core/integration.test.ts`: merge del candidato preciso come atto del Coordinatore con l'approvazione della persona invariata; nessun merge doppio; via libera mancante, senza versione del mandato o di un mandato cambiato; mandato revocato; pull request pubblicata prima; base spostata, decisione cambiata, altro lavoro sul branch, CI rossa, in corso o assente, conflitti; cambiamento concorrente tra controllo e merge; caso distruttivo con conseguenze e alternative; risposta persa con merge avvenuto; esito sconosciuto riletto al tentativo dopo; nuovo tentativo alla stessa destinazione.
- `app/src/main/core/coordinatorTools.test.ts`: `integrate_candidate` chiede `integrateCandidate` e riporta ogni esito.
- `app/src/shared/waitingForYou.test.ts`: la voce "Unione fermata" resta in "Aspetta te" finché la persona non la vede o la pull request non è unita.

## Schermate

Prima (`origin/main` 7e13d3f, lo stesso stato del progetto) e dopo, in chiaro e in scuro: `c09-unione-con-mandato/`.

## Limiti

- Nessuna prova su un repository GitHub reale: questo ambiente non ha un accesso GitHub autenticato. La prova diretta nell'app su un repository di prova autorizzato resta da fare.
- Il merge avviene solo su GitHub. La copia locale della persona non viene aggiornata.
- Se la base su GitHub si sposta tra la seconda lettura e il merge, GitHub unisce comunque se non ci sono conflitti: la finestra è di pochi istanti.
- Un repository senza CI non riceve merge dal Coordinatore.
- Motivi, conseguenze e alternative di un'unione fermata sono salvati in italiano: con l'interfaccia in inglese restano in italiano.
- Il riconoscimento dei casi distruttivi è per regole: una cancellazione di dati scritta in modo diverso dalle istruzioni SQL riconosciute non viene vista.
