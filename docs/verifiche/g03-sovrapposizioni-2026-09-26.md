# G03: avvisi di sovrapposizione in mappa, barra di focus e chat (2026-09-26)

Controllo dei criteri di #176 sul branch `feature/g03-overlap-warnings`, con le decisioni 3, 4, 9 e 10 di #173. Nessun modello reale è stato chiamato: l'ui-check usa il Codex di prova in `app/test-fixtures/fake-codex.mjs`.

## Come funziona

- `app/src/shared/overlap.ts` confronta ogni lato del lavoro della persona (il checkout, ogni agente al lavoro, ogni candidato non ancora unito, i moduli dei piani e degli incarichi di ogni task aperto) con ogni collega e ogni suo agente. Stesso modulo è un segnale leggero, stesso file un avviso, conflitto quando la prova di unione fallisce.
- Il conflitto viene sempre da `app/src/main/core/conflicts.ts`. `probeConflict` ora legge anche le righe in conflitto dall'albero scritto da `git merge-tree`, nella versione della persona. `app/src/main/core/overlap.ts` fa la stessa prova tra il checkout della persona e il branch pubblicato di ogni collega che tocca gli stessi file, nelle cartelle di Trama: il checkout e il branch del collega non cambiano. I conflitti già trovati sui candidati contro le pull request aperte valgono per l'agente che ha fatto il candidato.
- I tre momenti della decisione 4: prima di iniziare, la barra di focus e la coda mostrano i moduli del task già occupati, e all'avvio di un incarico il Coordinatore lo dice in chat; mentre si lavora, la barra di focus avvisa e il Coordinatore dice in chat, una volta, stesso file e conflitto; prima di pubblicare o unire, la scheda del candidato elenca i colleghi sugli stessi file.
- Mappa: accanto a moduli e file c'è chi ci lavora, con un colore per livello; il modulo e il file mostrano gli avvisi con il messaggio.
- Messaggio al collega: testo modificabile con file, branch e righe. Con una pull request aperta del collega sullo stesso branch, "Commenta la PR #N" lo invia come commento con `gh`; altrimenti "Copia il messaggio". Trama non invia nulla da sola.
- Nessun blocco: nessun pulsante sparisce o si disattiva per una sovrapposizione.

## Verificato

- `app/src/shared/overlap.test.ts`: i tre livelli, un task non iniziato confrontato per moduli, gli agenti dei colleghi, la pull request del collega, i segni della mappa, il testo del messaggio senza lineette, le righe lette dai marcatori di conflitto.
- `app/src/main/core/conflicts.test.ts`: la prova di unione riporta la riga 2 in conflitto.
- `app/src/main/core/overlap.test.ts`, con un remoto bare locale: conflitto confermato con la riga tra il checkout di Ada e il branch pubblicato di Bea, checkout e branch intatti, prova riusata finché nulla cambia; nessuna prova se i file non si incontrano o se il branch non è sul remoto; prova pulita su file diversi.
- `node scripts/ui-check.mjs`, passo `16d`-`16h`: scheda del Coordinatore in chat con la riga in conflitto, avviso nella barra di focus, messaggio a Bea con "Copia il messaggio" come ultima azione a destra, tema chiaro e scuro, segni su modulo e file nella mappa, checkout di Ada e branch di Bea invariati.

## Non verificato

- L'invio reale del commento su una pull request di GitHub: il percorso usa `commentOnIssue` di `github.ts`, già in uso, ma in questo ticket non è stato provato contro GitHub.
- Lo spostamento o il rinvio del compito di un agente della persona (decisione 10, seconda parte) e l'uso della presenza nell'assegnazione delle fette appartengono a G04 (#177).
