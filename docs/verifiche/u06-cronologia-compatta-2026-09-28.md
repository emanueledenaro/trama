# U06: cronologia compatta, passi tecnici in Attività (2026-09-28)

Controllo di #271 sul branch `feature/issue-271-compact-timeline`. Dall'audit #262, sezione 8.

## Cosa esisteva già

- Chat unica del progetto (U01), "Aspetta te" con i rimandi in chat per le schede aperte (#240), riga di stato e pannello Attività per le mosse automatiche (#241), riepilogo del Coordinatore, riferimenti cliccabili con i nomi al posto degli id (#285).
- Nella chat ogni turno di lavoro era una riga "Ha lavorato per ..." che si apriva sul posto con tutti i passi: note vuote, comandi ripetuti, "Strumento di Trama: read_issues" una volta per chiamata.
- Le schede risolte (decisione, mandato, team, incarico, piano, conflitto) restavano lunghe quanto quelle aperte.
- Una verifica fallita per la sandbox diventava una diagnosi del Bug triage sul progetto.

Il lavoro sposta e compatta: i testi delle schede e dei passi restano quelli di prima.

## Cosa cambia

- Passi tecnici in Attività (`app/src/shared/technicalSteps.ts`, `app/src/renderer/components/chat/WorkSteps.tsx`): la chat tiene una riga per turno, con chi ha lavorato, per quanto, quanti strumenti e quanti errori. La riga apre il pannello Attività su quel turno. Nella nuova sezione "Passi tecnici del lavoro" ogni turno ha la sua voce, dal più recente, con i passi raggruppati: una serie dello stesso passo è una voce con il numero (`×7`), le note e i ragionamenti senza testo non compaiono. Un turno fatto solo di note vuote non ha riga in chat.
- Schede risolte in una riga (`app/src/shared/settledCards.ts`, `app/src/renderer/components/chat/SettledCard.tsx`): decisione con risposta o ritirata ("Hai scelto: ..."), turno di chiarimento completo, mandato concesso o rifiutato, proposta del team confermata, piano superato, incarico concluso (o fermato e sostituito da un lavoro dopo), candidato superato, conflitto superato o già nell'avviso di progetto. La riga mostra titolo, argomento ed esito; il clic apre la scheda intera. Anche un collegamento o un passo successivo che porta alla scheda la apre. Le schede che aspettano la persona, o che hanno ancora un'azione (un incarico fermato con "Riprendi", un candidato deciso da pubblicare, un piano con le fette al lavoro), restano intere.
- Conflitti compatti: la scheda mostra i primi 5 file e "Mostra tutti i N file".
- Errori dell'ambiente (`app/src/main/core/duties.ts`): una verifica fallita per la sandbox o la macchina (permesso negato, disco in sola lettura o pieno, comando mancante, nota "[Trama] Alcuni fallimenti vengono dalla sandbox") non diventa una diagnosi del Bug triage e non cancella l'esito superato registrato prima. Su un candidato non cambia le evidenze né l'approvazione della persona: Trama lo scrive in Attività, e il cancello non fa partire i revisori: si chiude senza esito sul diff, con i revisori «non partiti» e non «non riusciti», finché la verifica non gira (la revisione si rilancia). Un'evidenza vecchia per altri motivi (per esempio una decisione cambiata) segue le regole di prima. Le registrazioni vecchie di questo tipo non avviano più diagnosi e non nascondono un fallimento del codice arrivato dopo sulla stessa versione. Riconosce anche il messaggio di `/usr/bin/env` quando manca un comando.

## Verifiche

- Test: `app/src/shared/technicalSteps.test.ts` (note vuote, serie dello stesso passo, errori a parte, turni con gli stessi id della chat, mosse automatiche escluse), `app/src/shared/settledCards.test.ts` (ogni tipo di scheda aperta e risolta), `app/src/main/core/duties.test.ts` (errori della sandbox senza diagnosi, errore del codice ancora diagnosticato, registrazione vecchia ignorata).
- ui-check, passo nuovo (`29a`, `29b`): un progetto con 7 `read_issues` di fila, due note vuote, lo stesso comando tre volte, una decisione con risposta, un mandato concesso, un incarico concluso e un conflitto su 18 file. Il controllo verifica che in chat non ci siano passi tecnici, che le tre schede risolte siano righe alte al massimo 48 px con il loro esito, che la riga apra e chiuda la scheda, che il conflitto mostri 5 file e poi tutti e 18, che in Attività il comando sia una voce `×3` senza le note vuote e i `read_issues` una voce `×7`, in chiaro e in scuro.
- Passi esistenti di ui-check adattati: la decisione con risposta, il turno di chiarimento completo, la proposta di mandato superata e quella rifiutata si cercano come righe e si aprono quando il passo legge la scheda (aiuti `openSettled` e `waitInCard`); le righe dei turni aprono Attività, che il passo chiude dopo la schermata; gli incarichi conclusi si cercano anche fra le righe; l'id della decisione si legge dallo stato invece che dal testo della scheda; il passo della divergenza (#267) cerca i conflitti e il candidato superati fra le righe e li apre.
- Schermate prima e dopo in `docs/images/u06/`: stessi dati del passo nuovo, prima con la build di main a `9eb7613`, dopo con questo branch unito a main `6aa7f7b`.
- Risultati su Linux nel container (xvfb), dopo il merge di main `6aa7f7b`: `tsc` senza errori, `vitest` 131 file e 1249 test passati (3 saltati), `npm run build` ok, `ui-check` completato con 345 schermate.

Non verificato: un progetto reale con centinaia di eventi; nessuna esecuzione reale di Codex.
