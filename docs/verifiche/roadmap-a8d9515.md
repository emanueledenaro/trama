# Riconciliazione dei criteri della roadmap

Codice esaminato: `a8d9515961a6ae20ccde44dbef9589f269b9acbd`. [CI riuscita](https://github.com/emanueledenaro/trama/actions/runs/34724052618).

Esito della revisione: 14 criteri verificati in 7 ticket; 5 ulteriori criteri hanno prove parziali esplicite. Gli altri restano da verificare. Nessun ticket è stato chiuso.

La revisione ha distinto le prove della finestra e del modello reale da quelle del trasporto simulato. I criteri parziali restano senza spunta anche quando una loro parte è già funzionante.

## #2

Restano i casi limite di apertura, permessi e navigazione completa da tastiera.

- [x] C1: App compilabile e avviabile, con sidebar, toolbar, SF Symbols e tema di sistema.
  Verificato: Build e avvio provati; sidebar, toolbar, SF Symbols e tema Sistema osservati direttamente nella finestra durante questo audit. [Prova 1](https://github.com/emanueledenaro/trama/actions/runs/34724052618) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 3](https://github.com/emanueledenaro/trama/blob/main/docs/verifiche/controlli-nativi-2026-09-13.md)
- [ ] C2: Primo avvio, selettore annullato, cartella vuota, cartella spostata e permesso negato hanno stati leggibili.
- [ ] C3: I progetti recenti persistono; il riavvio conserva la selezione senza riavviare agenti.
  Parziale: La riapertura è documentata, ma serve una traccia esplicita prima e dopo l’uscita completa, con selezione e attività confrontate. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md)
- [ ] C4: La selezione della cartella legge la struttura senza eseguire script, installare dipendenze o modificare il codice.
- [ ] C5: La navigazione essenziale è utilizzabile da tastiera e ha etichette accessibili.
- [ ] C6: CI macOS minima attiva dal primo incremento, con build e test significativi disponibili. Ogni incremento successivo conserva questi controlli verdi.
  Parziale: La CI corrente è verificata. Il criterio contiene anche la disciplina di integrazione dei successivi incrementi, che resta da verificare nel flusso di consegna. [Prova 1](https://github.com/emanueledenaro/trama/actions/runs/34724052618)

## #3

Restano login annullato o scaduto, account differente e riparazione su un Mac senza Codex.

- [x] C1: Versione del componente ufficiale rilevata e protocollo verificato; provider OpenAI esplicito per il processo di Trama.
  Verificato: Protocollo e provider verificati dai test e dal percorso reale CodexClient. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/CodexClientTests.swift) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618) [Prova 3](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/codex-integration.md)
- [x] C2: account/read precede il login: un account disponibile viene riconosciuto senza ripetere OAuth o copiare token.
  Verificato: Account ChatGPT esistente riconosciuto nell’app; ordine account/read prima del login coperto dai test. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/CodexClientTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [ ] C3: Accesso assente, scaduto, annullato, account differente e API key hanno stati distinti; nessun passaggio automatico alla fatturazione API.
- [ ] C4: Motore assente o incompatibile produce un percorso di installazione/riparazione documentato. Il componente viene distribuito solo dopo verifica di licenza e aggiornamenti.
- [ ] C5: Timeout, risposta malformata e uscita del processo terminano la richiesta pendente senza lasciare un falso stato connesso.
- [ ] C6: Una sessione controllata restituisce una risposta minima reale in sola lettura; la pianificazione collegata alle fonti appartiene a T06.
  Parziale: La risposta del modello reale è provata. L’audit conserva come parziale la dimostrazione completa dell’isolamento del turno reale, distinta dal contratto simulato. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/codex-integration.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md)

## #4

Serve la matrice completa delle operazioni autorizzate e degli errori di connessione, distinguendo app Codex e gh.

- [ ] C1: Scoprire collegamenti installati, accessibili, abilitati e utilizzabili; non dedurre questi stati dal login di gh o da un remote Git.
- [ ] C2: Aprire il collegamento ufficiale restituito dal componente, poi rileggere lo stato al ritorno dal browser; cancellazione e riconnessione restano recuperabili.
- [ ] C3: Verificare su un repository di prova lettura di branch, commit, diff, PR, review, issue e check; documentare per ogni operazione quale interfaccia la espone.
- [ ] C4: Se il collegamento non espone i dati strutturati necessari al monitoraggio, completare un adapter GitHub autorizzato oppure dichiarare quella capacità non disponibile. Il solo login non chiude il ticket.
- [ ] C5: Repository privato non accessibile, SSO richiesto, API limitata e connessione revocata non vengono interpretati come repository eliminato.
- [ ] C6: I servizi aggiuntivi vengono consigliati solo quando pertinenti al progetto e con il beneficio spiegato.

## #5

Il setup ha test e una prima prova; restano verifica completa del catalogo, conflitti, aggiornamento e rollback nel percorso utente.

- [ ] C1: Usare un insieme versionato delle skill Matt Pocock, con provenienza, licenza MIT, attribuzione e versione consultabili.
- [ ] C2: Rilevare repository, tracker, etichette e documentazione esistenti; configurare solo ciò che manca con impostazioni di Trama dichiarate e reversibili.
- [ ] C3: Il secondo avvio non duplica file o sezioni. Personalizzazioni preesistenti sono preservate; ogni aggiunta gestita è riconoscibile nel diff.
- [ ] C4: Una configurazione incompatibile richiede una decisione mirata. Non sovrascrivere regole per riuscire a mostrare setup completato.
- [ ] C5: Distinguere mappatura delle etichette dalla loro esistenza remota; creare etichette solo nel perimetro autorizzato del progetto.
- [ ] C6: Con pacchetto locale disponibile il setup funziona offline; aggiornamento fallito conserva la versione funzionante e permette rollback.
- [ ] C7: Confermare con il catalogo skill di Codex che le skill richieste siano caricate. Il setup automatico non esegue tutte le skill.
- [ ] C8: Il setup locale si completa con GitHub non collegato; le sole operazioni remote restano in attesa senza segnare fallito il setup locale.

## #6

Restano navigazione completa, modifica della struttura, limiti e accesso negato provati nell’app.

- [ ] C1: Raggruppamento strutturale funzionante su cartelle; primo supporto semantico limitato e dichiarato per SwiftPM. Altri linguaggi mantengono l’esplorazione dei file senza promesse di analisi completa.
- [ ] C2: Ogni modulo ha riferimenti verificabili a file reali; descrizioni dedotte e relazioni non risolte sono distinguibili dai fatti rilevati.
- [ ] C3: Vista ad albero equivalente, ricerca, selezione, percorso di risalita e anteprima del codice sono utilizzabili.
- [ ] C4: Aggiunta, rinomina e rimozione di file aggiornano la mappa; una lettura precedente non può sovrascrivere lo snapshot più recente.
- [ ] C5: Segreti, file esclusi, symlink verso altri percorsi e traversal non entrano nell’indice o nel contesto inviato a Codex.
- [ ] C6: File grandi, repository oltre i limiti dichiarati, file non UTF-8 e accesso negato producono analisi parziale esplicita.

## #7

Restano modifica manuale del piano, errori e limiti, interruzioni e risposte tardive nel percorso completo.

- [ ] C1: Richiesta, progetto, modulo, snapshot e riferimenti alle fonti restano associati anche dopo il riavvio.
  Parziale: Richiesta e piano sono documentati nel percorso locale. Serve il confronto esplicito delle associazioni a modulo, snapshot e fonti prima e dopo il riavvio. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md)
- [ ] C2: La pianificazione usa lettura soltanto e non modifica file né avvia effetti esterni.
  Parziale: Il piano reale e il sorgente locale invariato sono provati. L’assenza di tutti gli effetti esterni richiede una prova del runtime distinta dai test del trasporto simulato. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/CodexClientTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [ ] C3: Il piano mostra comportamento atteso, moduli coinvolti, limiti, ipotesi aperte e verifiche previste; può essere corretto dall’utente.
- [ ] C4: Streaming, annullamento, limite d’uso, assenza di rete ed errore del modello hanno stati espliciti e non perdono la richiesta.
- [ ] C5: Un cambiamento del repository durante l’analisi rende il piano da rivalutare; un risultato tardivo non sostituisce un piano più recente.
- [ ] C6: Le skill sono selezionate in base al compito; una richiesta semplice non avvia l’intero percorso di sviluppo.

## #8

Restano alternative corrette dall’utente, simulazione e indipendenza dei lavori nella UI. Il test del solo motore non chiude il criterio sull’intero flusso.

- [ ] C1: La scheda contiene caso concreto, alternative correggibili, risposta libera, esempio accettato e motivazione.
- [x] C2: Ogni variazione incrementa la versione; la cronologia conserva la scelta precedente.
  Verificato: Versione e cronologia della decisione verificate dal test del motore. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [ ] C3: I lavori dipendenti diventano da riallineare, quelli indipendenti restano validi.
- [ ] C4: Una simulazione è etichettata come tale; una spiegazione del modello non diventa risultato osservato.
- [x] C5: Il porting Swift del motore viene completato e verificato con test di comportamento, senza assumere validi i risultati salvati del prototipo TypeScript.
  Verificato: Motore Swift eseguito nella suite e usato nel percorso nativo. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618) [Prova 3](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md)
- [x] C6: I dati persistiti vengono validati prima del ripristino; dati incompleti non autorizzano candidati.
  Verificato: Il decoder rifiuta metadati incompleti e riferimenti incoerenti nei test del motore. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618)

## #9

Restano ampliamento del perimetro, stop e crash, ripresa e pulizia verificati nella finestra.

- [x] C1: Delegare versioni delle decisioni, perimetro, base e verifiche richieste a un worktree identificabile.
  Verificato: Sessione reale identificabile con base, perimetro e decisione confermata; test del motore e del worktree. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/WorkspaceSessionTests.swift) [Prova 4](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [x] C2: Modifiche locali preesistenti nel progetto sorgente restano byte-for-byte intatte; indice e branch originali restano preservati.
  Verificato: Sorgente conservato nella prova reale; fixture con file e indice sporchi preservati. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/WorkspaceSessionTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [ ] C3: Approvazioni di comandi, filesystem e rete seguono la politica effettiva del componente. Il worktree non viene presentato come sandbox.
- [ ] C4: Ampliamenti di perimetro o nuove decisioni fermano le operazioni interessate prima della successiva azione non autorizzata.
- [ ] C5: Stop, crash, base avanzata e riavvio mostrano lo stato effettivo; un comando già partito non viene dichiarato annullato senza conferma.
- [ ] C6: Riprendere è un’azione esplicita; pulizia del worktree non elimina lavoro da revisionare o modifiche dell’utente.

## #10

Resta soprattutto l’indipendenza delle decisioni nella UI: saveDecision invalida oggi tutte le richieste. Servono inoltre prove complete della navigazione e del ricontrollo in ogni azione.

- [x] C1: Il verificatore raccoglie esiti reali con comando, uscita, log, snapshot del candidato, base, versione delle decisioni e suite.
  Verificato: Il verificatore reale ha registrato comando, uscita, output e snapshot; metadati del patto coperti dai test. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/WorkspaceSessionTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 4](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [x] C2: Separare passato, fallito, non eseguito e non più attuale; le dichiarazioni dell’agente non possono creare evidenze o approvazioni.
  Verificato: Esiti falliti o non eseguiti rifiutati dal motore; stato obsoleto verificato nell’app; output dell’agente separato. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [x] C3: Cambio di candidato, base pertinente, decisione dipendente, suite o nuova esecuzione dei controlli revoca il precedente via libera.
  Verificato: Revoca sul cambio candidato provata nell’app; base, decisione, suite e nuova esecuzione coperti dai test del motore. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/docs/verifiche-locali.md) [Prova 2](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/PactEngineTests.swift) [Prova 3](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [ ] C4: Decisioni indipendenti e attività remote estranee non invalidano revisioni non coinvolte.
- [ ] C5: Diff, spiegazione del comportamento ed evidenze sono navigabili; approvazione locale non equivale a merge o pubblicazione.
- [ ] C6: Il candidato viene ricontrollato immediatamente prima di un’operazione che usa la revisione; cambiamenti concorrenti impediscono di agire sulla vecchia approvazione.

## #11

Serve il percorso reale di creazione da un’idea fino alla struttura generata e recuperabile.

- [ ] C1: Nome e cartella sono scelti dall’utente; cartelle non vuote e nomi in conflitto sono gestiti senza sovrascritture.
- [ ] C2: Scopo e struttura sono visibili prima della generazione; il bootstrap usa gli stessi piani, decisioni e autorizzazioni del flusso su repository esistente.
- [ ] C3: Il progetto generato entra nella mappa con riferimenti a file reali e nei recenti.
- [ ] C4: Errore o interruzione conserva il lavoro parziale e consente ripresa esplicita.
- [ ] C5: Creare un progetto locale non pubblica automaticamente un repository remoto.

## #12

Restano discussione delle issue, anteprima e pubblicazione dalla UI, matrice dei permessi e retry nel percorso reale.

- [ ] C1: Titolo, descrizione, stato e discussione provengono da GitHub; modulo, decisioni e sessioni sono collegamenti di Trama.
- [ ] C2: L’utente vede destinatario, branch, diff e testo della PR prima della pubblicazione.
- [ ] C3: Login del connettore e permesso di push Git sono verificati separatamente; mancanza di uno non viene mascherata dall’altro.
- [ ] C4: Retry dopo timeout riconcilia l’eventuale PR già creata, senza duplicarla.
- [x] C5: Fine dell’agente non chiude l’issue; pubblicazione, CI remota, merge e chiusura restano stati distinti.
  Verificato: PR, merge e CI sono eventi separati; la pubblicazione reale non ha chiuso i ticket. [Prova 1](https://github.com/emanueledenaro/trama/pull/20) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618)
- [x] C6: Una modifica tra revisione e pubblicazione richiede nuova verifica del candidato.
  Verificato: Cattura immutabile e rifiuto dello snapshot modificato coperti dai test; controllo ripetuto prima della pubblicazione. [Prova 1](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Tests/TramaCoreTests/GitPublicationTests.swift) [Prova 2](https://github.com/emanueledenaro/trama/actions/runs/34724052618) [Prova 3](https://github.com/emanueledenaro/trama/blob/a8d9515961a6ae20ccde44dbef9589f269b9acbd/Sources/Trama/IssuesView.swift)

## #13

Restano force push, fork, rinomina, paginazione, errori e limiti nel monitor reale.

- [ ] C1: Conservare snapshot per repository, branch, SHA, fonte e istante di sincronizzazione; mostrare separatamente checkout locale e stato remoto.
- [ ] C2: Gestire nuovi branch, branch eliminati, PR da fork, cambio della base, force push e paginazione senza riutilizzare analisi obsolete.
- [ ] C3: Polling efficiente con richieste condizionali e rispetto dei limiti; nessun modello chiamato per controlli senza novità.
- [ ] C4: Rete assente, revoca, repository rinominato, risposta incompleta e API limitata conservano l’ultimo stato marcato non aggiornato.
- [ ] C5: Un fetch aggiorna i riferimenti remoti senza checkout, pull, merge o modifica automatica del branch dell’utente.
- [ ] C6: Il lavoro non pubblicato dagli altri è indicato come non osservabile; l’autore di un commit non viene presentato automaticamente come persona attualmente al lavoro.

## #14

Restano avviso nativo del conflitto remoto, base mancante e aggiornamento concorrente nella stessa prova.

- [ ] C1: Il confronto usa base comune e snapshot precisi di entrambi i lavori, compreso il lavoro locale non committato che si dichiara di controllare.
- [ ] C2: La prova di integrazione non modifica checkout, indice, branch, hook o file dell’utente.
- [ ] C3: Toccare lo stesso file senza collisione produce attività collegata, non un falso conflitto.
- [ ] C4: L’avviso collega le parti incompatibili ai rispettivi branch e commit; base mancante o confronto incompleto produce esito non verificabile.
- [ ] C5: Lavoro modificato durante la prova rende obsoleto il risultato e provoca un nuovo confronto limitato alle parti interessate.
- [ ] C6: Ogni evidenza registra snapshot di entrambi i lavori, base comune, procedura o comando ed esito; un cambiamento di uno degli input la rende obsoleta.

## #15

Servono prove modello con casi indipendenti di incompatibilità, duplicazione e API cambiate, mantenendo distinta l’interpretazione dalla verifica.

- [ ] C1: Analizzare diff, contesto del codice, issue, PR e decisioni; un messaggio di commit da solo non basta a dichiarare il comportamento.
- [ ] C2: Ogni interpretazione rimanda a fonti e SHA; fatti osservati e ipotesi sono distinguibili, senza percentuali di confidenza inventate.
- [ ] C3: Rilevare nei casi controllati incompatibilità tra file diversi, lavoro duplicato, API cambiate e piani superati.
- [ ] C4: Una possibile incoerenza diventa violazione verificata solo dopo uno scenario attendibile eseguito sul candidato combinato, con evidenza prodotta dal verificatore.
- [ ] C5: Testare casi positivi e negativi, fixture non viste nell’implementazione, errore del modello, input ambiguo e istruzioni malevole nei contenuti GitHub trattate come dati.
- [ ] C6: Richieste e risultati vecchi vengono cancellati o scartati quando cambia lo snapshot; nessun modello può promuovere da solo una propria conclusione a revisione umana.

## #16

Restano selettività, aggregazione, budget e risoluzione degli avvisi nel percorso completo.

- [ ] C1: Separare attività collegata, possibile incoerenza, conflitto riprodotto e decisione richiesta.
- [ ] C2: Mostrare autore quando noto, PR/branch, fonti, conseguenza sul lavoro corrente e azioni Esamina, Rivedi piano, Segna come valutato.
- [ ] C3: Un nuovo evento rivaluta solo piani ed evidenze dipendenti; il lavoro non coinvolto continua.
- [ ] C4: Un conflitto verificato che blocca il patto impedisce la successiva integrazione; la sospensione di un agente segue il perimetro e preserva quanto già scritto.
- [ ] C5: Deduplicare avvisi e risultati, aggregare raffiche di commit, usare cache per SHA e limiti di concorrenza/uso dei modelli.
- [ ] C6: Raggiunti limiti del servizio o budget concordati, continuare raccolta deterministica disponibile e mostrare analisi AI in attesa; nessun fallback a pagamento non autorizzato.
- [ ] C7: La notifica si risolve o si aggiorna quando cambia la situazione; ignorare un avviso non equivale ad approvare il candidato.

## #17

Il servizio non è stato registrato nella prova: restano avvio al login, sospensione, riconnessione, notifiche e disattivazione.

- [ ] C1: Attivazione, disattivazione e avvio al login sono visibili e passano dai meccanismi Apple appropriati.
- [ ] C2: Chiudere la finestra, terminare l’app, fermare il monitor e sospendere il Mac hanno comportamenti distinti e dichiarati.
- [ ] C3: Il monitor lavora soltanto sui progetti abilitati, con limiti energetici e di uso dei modelli; non riavvia sessioni di modifica del codice.
- [ ] C4: Un solo coordinatore gestisce eventi e coda quando UI e helper sono attivi; i lock e i cursori persistiti evitano doppie analisi.
- [ ] C5: Al risveglio o ritorno in rete riconciliare dal checkpoint agli SHA attuali, aggregare novità e mostrare l’ultimo aggiornamento effettivo.
- [ ] C6: Notifiche negate o suoni disabilitati mantengono tutti gli avvisi consultabili nell’app.
- [ ] C7: Al primo avvio monitor in background e avvio al login sono disattivati; nessun helper viene registrato prima dell’attivazione esplicita. Disattivare annulla la registrazione e la scelta persiste. La sincronizzazione in primo piano del progetto aperto resta distinta.

## #18

Restano accessibilità completa, misure e matrice visiva; dipende anche da responsive #21 e design #22.

- [ ] C1: Verificare dal doppio clic accesso, collegamenti, apertura/creazione, mappa, richiesta, decisione, esecuzione, revisione e ritorno al progetto.
- [ ] C2: Sidebar, toolbar, inspector, finestre, selettori e menu sono nativi; l’immagine iniziale ispira la composizione, il design Apple guida i controlli.
- [ ] C3: Tema chiaro/scuro, Riduci movimento, contrasto, navigazione completa da tastiera e VoiceOver: la vista ad albero offre un’alternativa alla mappa.
- [ ] C4: Stati vuoto, caricamento, parziale, errore, offline e ripristino verificati su finestre ridimensionate, senza controlli nascosti.
- [ ] C5: Nessun suono per token, lettura di file o test. Un suono discreto facoltativo accompagna solo avvisi utili, con preferenze persistenti e rispetto delle impostazioni di notifica.
- [ ] C6: Misurare reattività su fixture da 100, 1000 e 10000 file; UI utilizzabile durante indice e analisi, limiti espliciti e risultati documentati.

## #19

Restano verifica completa della documentazione e della distribuzione; firma Developer ID, notarizzazione e secondo Mac non sono provati.

- [x] C1: Clone pulito, compilazione Release, test e creazione dell’app riusciti in CI macOS; risorse necessarie incluse.
  Verificato: Clone del codice pubblico testato; build Release sul candidato e CI macOS riuscite. [Prova 1](https://github.com/emanueledenaro/trama/actions/runs/34724052618) [Prova 2](https://github.com/emanueledenaro/trama/pull/20)
- [ ] C2: README documenta requisiti verificati di macOS, Swift e Codex, onboarding, supporto dei repository e funzionamento del monitor.
- [ ] C3: Licenze e attribuzioni del progetto, skill AI Hero e componente Codex sono verificate prima di redistribuirli; nessuna dipendenza locale implicita.
- [ ] C4: Evidenze distinguono build locale, test, prova UI, CI remota, firma e notarizzazione. La firma ad hoc locale non viene presentata come distribuzione macOS verificata.
- [ ] C5: La beta pubblica scaricabile resta separata finché firma Developer ID, notarizzazione e installazione su un secondo Mac non sono verificate.

## #21

Il ticket responsive è da implementare e verificare alle dimensioni definite.

- [ ] C1: Provare aree di contenuto di 720×640, 1040×700, 1280×800, 1440×900 e 1920×1080 punti; documentare la nuova dimensione minima supportata.
- [ ] C2: Sidebar e inspector si comprimono o si chiudono in modo prevedibile. I pulsanti per riaprirli restano disponibili e il contesto selezionato viene conservato.
- [ ] C3: La mappa usa colonne adattive. Titoli, percorsi e badge non si sovrappongono; selezione, ricerca e apertura dei file funzionano a ogni dimensione.
- [ ] C4: Le azioni principali restano visibili o raggiungibili con lo scorrimento. Nessun pulsante di conferma o annullamento viene tagliato nelle finestre modali.
- [ ] C5: Gli editor del piano, i dettagli delle issue e gli output si adattano senza ridurre artificialmente la dimensione del testo. Lo scorrimento orizzontale resta confinato ai contenuti che lo richiedono, come codice e diff.
- [ ] C6: Verificare testo lungo, nomi di branch e percorsi lunghi, liste vuote, caricamento, errore e contenuti numerosi.
- [ ] C7: Provare finestra affiancata, schermo intero, apertura e chiusura dell’inspector e passaggio tra le sezioni senza salti della selezione o dimensionamenti forzati.
- [ ] C8: Tutte le azioni restano utilizzabili da tastiera e con etichette accessibili.

## #22

Il ticket di allineamento visivo è da implementare e verificare con schermate confrontabili.

- [ ] C1: Definire e documentare una scala di spaziatura riutilizzabile, coerente con i controlli di sistema. Sostituire i valori isolati che producono distanze diverse per lo stesso tipo di contenuto.
- [ ] C2: Allineare titoli, testi, icone, campi e pulsanti sulle stesse guide. Verificare margini laterali, spazi tra sezioni e baseline delle righe.
- [ ] C3: Distinguere titolo, sottotitolo, corpo e metadati con gli stili tipografici di sistema. Evitare testo troppo piccolo e conservare leggibilità con contenuti lunghi.
- [ ] C4: Uniformare dimensioni e peso degli SF Symbols, altezza dei campi, forme dei contenitori, separatori e stati dei pulsanti.
- [ ] C5: Rendere coerente la posizione delle azioni principali e secondarie. Conferma e annullamento restano riconoscibili; le etichette dei campi sono visibili anche quando i campi sono compilati.
- [ ] C6: Equilibrare densità delle liste e spazio delle aree di lavoro, senza grandi vuoti accidentali o gruppi troppo compressi.
- [ ] C7: Usare colori e materiali semantici di sistema. Verificare tema chiaro e scuro, aumento del contrasto, riduzione della trasparenza, focus da tastiera e stato disabilitato.
- [ ] C8: Selezione, caricamento, errore, verifica superata e verifica da ripetere hanno una presentazione coerente e comprensibile anche senza il solo colore.
- [ ] C9: Eseguire un controllo visivo comparato di tutte le sezioni e delle finestre modali con dati identici, includendo una finestra stretta e una ampia.

## #23

Estensione registrata su richiesta dell’utente. Il selettore non è presente nella versione osservata; nessuna implementazione avviata in questo passaggio.

- [ ] C1: Leggere il catalogo dei modelli OpenAI esposto dal componente ufficiale Codex, verificando il contratto della versione supportata. Distinguere catalogo disponibile e reale autorizzazione dell’account all’uso di un modello.
- [ ] C2: Mostrare un selettore nativo macOS vicino alla richiesta, con nome del modello selezionato e descrizione quando disponibile.
- [ ] C3: Conservare la scelta per progetto tra riavvii e ripristinarla senza modificare la configurazione globale di Codex.
- [ ] C4: Passare esplicitamente il modello scelto alla pianificazione e all’esecuzione; rendere visibile anche quale modello usa l’analisi delle attività del gruppo.
- [ ] C5: Registrare nella richiesta il modello usato. Cambiare selezione durante un’attività non cambia retroattivamente il modello di quella già avviata.
- [ ] C6: Gestire caricamento, catalogo vuoto, errore, accesso scaduto e modello non più disponibile. Non sostituire silenziosamente il modello scelto con un altro.
- [ ] C7: Conservare provider OpenAI, accesso ChatGPT gestito dal componente ufficiale e isolamento degli strumenti. Nessun passaggio automatico a credenziali API o a un altro provider.
- [ ] C8: Verificare accessibilità, nomi lunghi e comportamento del selettore nelle finestre strette, coordinandosi con #21 e #22.

