# A07: unione dei candidati con il via libera; quelli di interfaccia aspettano la persona

Data: 28 settembre 2026. Issue #247, specifica #239 (Q1, Q9), ADR 0017 che aggiorna l'ADR 0003. Base: `origin/main` d550ab7.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`) e il gh finto (`app/test-fixtures/fake-gh.mjs`). Nessuna esecuzione reale di un provider e nessuna pull request vera su GitHub.

Su Linux nel container (xvfb), dopo il merge di `origin/main` a `d550ab7`:

- `npm ci`: riuscito.
- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 135 file, 1265 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: corsa completa, uscita 0, 357 schermate. Passo nuovo `30a`-`30e`, in chiaro e in scuro. Una corsa precedente sulla stessa base si era fermata al passo del monitor ("Monitor attivo" non visibile entro il tempo), un passo che questo lavoro non tocca; la corsa successiva è passata. Anche una corsa prima dell'ultimo merge di main era passata con 357 schermate.
- `npm run check:names`, `npm run check:upstream-names`: ok.
- `node scripts/conventional-commits/cli.mjs commit-range origin/main HEAD`: ok.
- Dopo il merge di `origin/main` a `6b6e33a` (#219, nessun file in `app/`): `npx tsc --noEmit -p .` senza errori, `npx vitest run` con 135 file e 1265 test superati, `npm run build` riuscito. La ui-check non è stata rieseguita su questa base: il codice dell'app è lo stesso della corsa verde su `d550ab7`.
- Dopo il merge di `origin/main` a `be82ad6` (#299, conflitto in `Cards.tsx` risolto tenendo le due parti): `npm ci` riuscito, `npx tsc --noEmit -p .` senza errori, `npx vitest run` con 136 file e 1276 test superati (3 saltati), `npm run build` riuscito, `xvfb-run -a node scripts/ui-check.mjs` completata con uscita 0 e 359 schermate.
- Dopo il merge di `origin/main` a `c4e8aff` (#308, dipendenze aggiornate): `npm ci` riuscito, tsc senza errori, vitest con 136 file e 1276 test superati, build riuscita, ui-check completata con uscita 0 e 359 schermate.
- Dopo il merge di `origin/main` a `7e13d3f` (#304, cancello dei revisori): tsc senza errori, vitest con 136 file e 1277 test superati, build riuscita, ui-check completata con uscita 0 e 359 schermate.
- Dopo il merge di `origin/main` a `8bf9f4a` (#303, scelta della lingua): `npm ci` riuscito, tsc senza errori, vitest con 139 file e 1297 test superati (3 saltati), build riuscita, ui-check completata con uscita 0 e 363 schermate.

## Comportamento

- Un candidato verificato, con il cancello dei revisori superato sulla sua versione e il via libera del Coordinatore dentro il mandato (`integrateCandidate` sui suoi moduli), non passa più dalla persona. Trama lo pubblica come pull request, con lo standard di pubblicazione e il mandato per il push (`openPullRequest`), e unisce la pull request con un commit di merge sul commit che ha pubblicato (`sha` della chiamata a GitHub). Il titolo del commit di merge è quello del candidato con il numero della pull request, per esempio `feat(orders): ... (#21)`.
- Prima di unire Trama legge le verifiche della pull request: se girano, o se la pull request è appena aperta e non ne ha ancora, aspetta e riprova. Con verifiche rosse non unisce e lo scrive. Un'unione che GitHub rifiuta si riprova dopo cinque minuti; Trama non chiede mai di scavalcare le protezioni del branch. Un'unione interrotta da un riavvio riparte.
- L'unione va in Attività ("Candidato unito con il via libera del Coordinatore", con "Apri la pull request") e, come traguardo, nel riepilogo, anche in "Cosa ho fatto". Nella chat il candidato unito diventa una riga "Unito, #21".
- Un candidato che cambia l'interfaccia non si unisce da solo. Trama lo riconosce dai file toccati (`app/src/shared/interfaceChange.ts`): componenti, markup, stili, viste, le cartelle dell'interfaccia e le sue immagini; test, documentazione e dati no. Il candidato va in "Aspetta te" come "Interfaccia da guardare", con i file che cambiano l'interfaccia e le schermate prima e dopo, in chiaro e in scuro.
- Le schermate le fa il progetto: lo script `screenshots` del suo `package.json` salva PNG in `TRAMA_SCREENSHOTS_DIR` nel tema `TRAMA_THEME`. Trama lo esegue nella sua sandbox sulla base del candidato (un worktree temporaneo, tolto alla fine) e sul candidato, in chiaro e in scuro, e tiene le immagini nella sua cartella. Senza lo script la scheda dice perché non ci sono schermate e il candidato aspetta lo stesso la persona.
- "Approva e unisci" dà l'ok della persona e Trama unisce la pull request: Attività scrive "Candidato unito con il tuo ok". "Rifiuta" chiede il motivo; il rifiuto è registrato sul candidato, il candidato esce da "Aspetta te" e il motivo torna allo sviluppatore come rilievo, nella stessa sessione e nello stesso worktree. In chat il candidato rifiutato diventa una riga "Rifiutato da te" con il motivo.
- Via libera e ok restano distinti: il via libera è del Coordinatore, l'ok è della persona, e nessuno dei due sostituisce l'altro. Tutti e due valgono per la versione precisa del candidato (versione del worktree, decisioni, evidenze): un candidato cambiato dopo il via libera o dopo l'ok non si unisce con quelli vecchi, e al momento dell'unione Trama lo controlla di nuovo.
- Un'unione che richiederebbe un divieto fisso si ferma prima di qualsiasi push e diventa una voce "Azione vietata" di "Aspetta te": il branch del candidato è quello principale (`pushMainBranch`), il candidato tocca segreti (`secrets`) o le impostazioni del repository, come `CODEOWNERS` (`repositorySettings`).
- Senza un remoto GitHub, o con un mandato che non copre l'integrazione, il candidato resta alla persona come prima: "Candidato da guardare", "Approva questo candidato", "Prepara la pull request".
- Il Coordinatore legge a ogni turno che con il suo via libera Trama unisce da sola e che i candidati di interfaccia aspettano la persona; `clear_candidate` gli dice quale strada prende il candidato.

## Test

- `app/src/shared/interfaceChange.test.ts`: file che cambiano l'interfaccia e file che non la cambiano, anche dentro le cartelle dell'interfaccia.
- `app/src/main/core/merge.test.ts`: unione con il via libera solo dopo il cancello superato; candidato di interfaccia che aspetta l'ok e si unisce con l'ok; rifiuto che ferma l'unione finché un ok non lo ritira; nuove evidenze o una decisione cambiata che tolgono via libera e ok; divieti fissi; strada della persona senza mandato o senza remoto; nuovo tentativo dopo un rifiuto di GitHub; nessuna seconda unione.
- `app/src/main/core/interfaceShots.test.ts`: con lo script del progetto quattro PNG, diversi tra prima e dopo e tra chiaro e scuro, e il worktree della base tolto; senza lo script il motivo.
- `app/src/shared/waitingForYou.test.ts`: il candidato che Trama unisce non aspetta la persona, quello di interfaccia sì, quello rifiutato no.
- `app/src/shared/settledCards.test.ts`: righe del candidato unito e rifiutato.
- `app/src/main/merge.integration.test.ts`: prova con un repository di prova, un remoto locale per i push e il gh finto. Il candidato senza interfaccia viene pubblicato e unito da solo sul commit pubblicato, il branch principale del remoto non riceve push, l'unione è in Attività e nel riepilogo. Il candidato di interfaccia ha le quattro schermate, aspetta la persona, il rifiuto torna allo sviluppatore, il candidato corretto si unisce con l'ok. Il candidato che cambia `CODEOWNERS` si ferma sul divieto fisso ed è in "Aspetta te".

## Schermate

Prima e dopo, in chiaro e in scuro, in `a07-unione-con-via-libera/`. Le schermate "prima" vengono da `origin/main` 58ec23f, con la stessa prova della ui-check (lo stesso progetto con lo script `screenshots` e il gh finto) eseguita sulla build di main solo per questa prova.

- 01-04: un candidato senza modifiche all'interfaccia, verificato e con il via libera. Prima aspetta la persona con "Approva questo candidato"; dopo Trama lo unisce da sola e Attività e il riepilogo lo dicono.
- 05-08: un candidato che cambia `web/index.css`. Prima è un "Candidato da guardare" senza schermate; dopo è un'"Interfaccia da guardare" con le schermate prima e dopo, in chiaro e in scuro, e "Rifiuta" e "Approva e unisci" a destra, il primario per ultimo.
- 09-10: la stessa scheda a 900 px di larghezza.
- 11-14: il rifiuto con il motivo, e la riga "Rifiutato da te" nella chat.
- 15-16: Attività dopo l'unione con l'ok della persona.

## Limiti

- Nessuna pull request vera: GitHub è il gh finto, che apre la pull request 21, dice che non ha verifiche e accetta l'unione. Le protezioni del branch, le verifiche richieste e i metodi di unione di un repository vero non sono stati provati.
- Il riconoscimento dell'interfaccia usa i nomi dei file: un file di logica dentro una cartella dell'interfaccia conta come interfaccia, e un file che disegna l'interfaccia con un nome insolito può sfuggire.
- Le schermate dipendono dallo script del progetto. Trama le fa nella sua sandbox senza rete, con le dipendenze del checkout del progetto; uno script che deve scaricare qualcosa non riesce.
- Il candidato unito non aggiorna il checkout locale del progetto: il branch principale locale resta dov'era finché la persona non lo aggiorna.
- La fase del lavoro propone ancora alla persona "Rivedi il candidato" o "Unisci la pull request" mentre Trama sta unendo da sola.
