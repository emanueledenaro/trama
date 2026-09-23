# Stato dell'alpha locale

Dal 23 settembre 2026 l'app desktop è in Electron, in `app/`, con l'interfaccia di Synara. Cosa è stato portato e cosa è stato verificato è nell'[ADR 0011](adr/0011-app-desktop-electron-con-design-synara.md). Questa pagina descrive la versione SwiftUI.

Questa pagina conserva il bilancio dell'alpha iniziale. Per il piano vigente approvato dopo l'intervista sul Coordinatore leggere [piano operativo](piano-operativo.md), [specifica Coordinatore](spec-coordinatore.md) e [raccordo aggiornato di ogni criterio](verifiche/roadmap-coordinatore.md). Le prove riportate qui restano storiche e non attestano le nuove funzioni.

Stato esaminato il 13 settembre 2026. Questa pagina separa il codice presente dalle prove ancora necessarie. Nessun ticket T01-T18 è segnato come chiuso da questo documento.

## Stato osservato

- Il repository pubblico è [emanueledenaro/trama](https://github.com/emanueledenaro/trama). `docs/pianificazione/github.json` collega la specifica alla issue 1 e i ticket T01-T18 alle issue 2-19.
- Questo documento accompagna il primo incremento dell’app, successivo al commit iniziale della documentazione `d492830`. Commit, pull request e risultati CI sono consultabili nella cronologia GitHub.
- L'app è composta da target Swift Package Manager per `Trama`, `TramaCore` e `TramaMonitor`. La piattaforma minima dichiarata è macOS 14.
- Il riconoscimento di un account ChatGPT è stato verificato sul Mac di sviluppo. Una risposta minima reale è stata ottenuta attraverso la stessa classe CodexClient usata dall'app, con provider OpenAI, account ChatGPT e strumenti esterni disabilitati.
- `.github/workflows/swift.yml` esegue build e test su macOS 15. Il risultato sul commit pubblicato va verificato nella relativa esecuzione GitHub Actions.
- `scripts/build-app.sh` crea una app locale con firma ad hoc. Non produce una firma Developer ID e non esegue notarizzazione.
- Il codice per registrare `TramaMonitor` tramite `SMAppService` è presente. L'helper non è stato registrato sul Mac di prova e non è stato verificato a finestra chiusa, dopo logout o dopo sospensione.

Le sole modifiche documentali non eseguono build, test, login, chiamate modello o operazioni GitHub. I riferimenti ai test nella matrice indicano test presenti nel repository, non un nuovo risultato di esecuzione.

## Riconciliazione dei criteri

La [riconciliazione sul commit a8d9515](verifiche/roadmap-a8d9515.md) collega ogni criterio alle prove disponibili e identifica quelli ancora da verificare. Sono stati riconosciuti 16 criteri in 8 ticket, con altri 3 criteri parziali; nessun ticket è stato chiuso. Comprende anche responsive #21, design #22 e l’estensione modelli #23.

## Matrice T01-T18

| Ticket | Presente nel codice | Verifica o parte mancante |
| --- | --- | --- |
| T01 | Shell SwiftUI nativa, apertura progetto, catalogo dei recenti con bookmark, ripristino dello stato e scanner in sola lettura. Sono presenti test per identità, spostamento e catalogo corrotto. | Avvio, riavvio con contesto persistito e CI corrente sono provati. Restano selettore annullato, cartella vuota, permesso negato, tastiera e VoiceOver completi. |
| T02 | `CodexClient` usa Codex App Server 0.148.0, riconosce account ChatGPT, gestisce login, timeout, JSON errato e uscita del processo. I test usano un trasporto simulato. | Il turno minimo reale e il piano nella finestra sono provati. Restano da provare login annullato o scaduto e percorso di riparazione su un Mac senza Codex. |
| T03 | Lettura dello stato delle app Codex e adapter GitHub CLI per account, snapshot, confronto, issue e pubblicazione. Gli errori di accesso hanno stati distinti nei test. | Matrice autenticata su un repository di prova per branch, commit, diff, PR, review, issue e check. Lo stato del connettore GitHub deve essere provato separatamente da `gh`. |
| T04 | Pacchetto AI Hero 1.2.3 incluso con licenza e commit sorgente documentati. Il setup preserva file esistenti, è ripetibile e scrive le istruzioni mancanti. | Conferma sul catalogo Codex reale del progetto, prova offline completa e percorso di aggiornamento o rollback verificato. La creazione remota delle etichette non è compresa nel setup locale. |
| T05 | Scanner per Swift e JavaScript o TypeScript, raggruppamento per percorsi, mappa, vista elenco, ricerca e anteprima. Test presenti per symlink, traversal, segreti, file grandi, limiti e cambio snapshot. | Prova manuale di navigazione e accessibilità. Mancano misure su repository di dimensioni diverse e prove UI per accesso negato, file non UTF-8 e risultati parziali. |
| T06 | La richiesta conserva snapshot, modulo e proposta strutturata. `PlanProposal` valida moduli e file, mostra comportamento, passi, esempio da confermare e domande. La pianificazione dichiara sola lettura e schema JSON. | Piano reale e schermata di conferma provati. Restano modifica manuale completa del piano, stati offline e limite d'uso, riavvio durante analisi e prova che una risposta tardiva non sostituisca quella nuova. |
| T07 | Schede con scenario, alternative e risposta libera. `PactEngine` incrementa le versioni, conserva la cronologia e invalida solo i lavori dipendenti nei test. | Percorso UI completo su una decisione creata e poi rivista. Va verificata la presentazione delle simulazioni e il ripristino da dati persistiti corrotti nell'app. |
| T08 | Creazione di worktree dedicati, delega di base e decisioni, esecuzione Codex separata, approvazioni esplicite e sandbox dei check. I test controllano che checkout, indice e file sorgente restino intatti. | Esecuzione reale con Codex e ripristino della sessione provati. Restano stop durante un comando, crash e riavvio, ripresa esplicita e gestione della pulizia di un worktree con lavoro non revisionato. |
| T09 | Evidenze legate a candidato, base, decisioni e suite; revoca dell'approvazione su cambiamenti pertinenti; check limitati in tempo e output. | Percorso UI con due test del candidato, approvazione e revoca provati. Restano prove estese sulle decisioni indipendenti e il ricontrollo nell’anteprima di pubblicazione. |
| T10 | La schermata Nuovo progetto sceglie nome e cartella, rifiuta un percorso esistente, crea un README, inizializza Git e apre una richiesta di pianificazione. | Generazione effettiva della struttura, anteprima dello scopo, interruzione e ripresa del lavoro parziale, test automatici e prova che nessun remoto venga creato. |
| T11 | Lettura e creazione issue, preparazione di un commit immutabile, anteprima e creazione PR con controllo di base e head. Sono presenti test per timeout, riconciliazione e cambio candidato. | Il componente ha pubblicato realmente la PR #20, poi integrata con CI verde. Restano anteprima e pubblicazione dalla finestra, matrice dei permessi e retry nel percorso reale. |
| T12 | Snapshot GitHub e attività con commit, review e check, richieste condizionali ETag, eventi per branch e PR, checkpoint e lease tra processi. Snapshot e attività hanno una scadenza complessiva di 40 secondi. | Prove live per force push, PR da fork, repository rinominato e paginazione. Il polling condizionale e il consumo dei limiti GitHub devono essere misurati. |
| T13 | Confronto Git isolato su snapshot locale e SHA remoto, inclusi file non committati e commit recuperati nella cache. Lo stesso file senza collisione resta un esito pulito nei test. | Avviso UI completo su un conflitto remoto reale, base mancante e cambiamento durante la prova. Le evidenze devono essere rilette dall'interfaccia con entrambi gli snapshot. |
| T14 | Adapter semantico con schema, fonti e SHA validati, stati prudenziali e rifiuto di istruzioni malevole o autorità inventata. La coda considera PR e branch e scarta risultati obsoleti. | Turni modello reali e fixture semantiche indipendenti per incompatibilità, duplicazione, API cambiate e piano superato. Una possibile incompatibilità resta un'interpretazione finché il verificatore non esegue uno scenario. |
| T15 | Deduplica per contesto, cache limitata, limite delle analisi automatiche, notifiche per possibili incompatibilità e conflitti riprodotti. | Le azioni UI Esamina, Rivedi piano e Segna come valutato sono presenti. Restano la verifica dell’aggregazione di una raffica di commit, gestione visibile del budget e risoluzione completa degli avvisi. |
| T16 | Helper `TramaMonitor`, configurazione disattivata per impostazione iniziale, `SMAppService`, checkpoint condiviso e lease per evitare due coordinatori. | Registrazione reale dell'helper, disattivazione, finestra chiusa, app terminata, sospensione, risveglio, consumo energetico e comportamento con notifiche negate. L'helper non è registrato nello stato corrente. |
| T17 | Controlli SwiftUI e AppKit nativi, sidebar, toolbar, inspector, selettori, tema chiaro o scuro e alcune etichette di accessibilità. | Prova dal doppio clic dell'intero percorso, VoiceOver, tastiera completa, Riduci movimento, contrasto, finestre ridimensionate e stati offline. Mancano misure con fixture da 100, 1000 e 10000 file. |
| T18 | Repository pubblico, workflow macOS preparato, script Release, risorse incluse e firma ad hoc locale. | Sorgente pubblicato, clone pulito, test e build Release in CI sono provati. Restano verifica completa della documentazione e della distribuzione, Developer ID, notarizzazione e installazione su un secondo Mac. |

## Supporto dei repository

Il prodotto è scritto in Swift e SwiftUI. Lo scanner accetta sorgenti Swift e file `js`, `ts`, `mjs`, `cjs`, `jsx` e `tsx`, oltre a `package.json`. L'analisi degli import è diretta per Swift e limitata agli import riconoscibili per JavaScript e TypeScript. I moduli derivano dai percorsi presenti nel repository. Non esiste un modulo semantico inventato per linguaggi o strutture non supportate.

## Condizioni per chiamarla beta

La dicitura beta locale richiede almeno un clone pulito del codice pubblicato, build Release, test sullo stesso commit, avvio dell'app e un percorso manuale principale completato. La distribuzione scaricabile richiede anche licenza della radice, verifica dei termini Codex, firma Developer ID, notarizzazione e installazione su un altro Mac. La prima alpha ha codice pubblico, build e prove del percorso principale. La roadmap completa e la distribuzione scaricabile non sono ancora verificate.
