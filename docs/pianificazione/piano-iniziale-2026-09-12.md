# Piano operativo di Trama

Data: 12 settembre 2026. Stato: piano autorizzato dall’utente per pubblicazione dei ticket e implementazione autonoma. Ogni ticket viene chiuso soltanto dopo le verifiche previste.

## Risultato da ottenere

Aprire un’app macOS, ritrovare i collegamenti disponibili e iniziare a lavorare su un progetto con il metodo AI Hero già configurato. La mappa resta collegata al codice e si aggiorna quando cambiano i file locali o il lavoro condiviso su GitHub. Codex aiuta a comprendere le modifiche, pianificarle ed eseguirle; avvisa quando il lavoro del gruppo interferisce con il proprio.

Ogni avviso deve permettere di risalire alle fonti. Il Patto Vivo collega decisioni, attività ed evidenze alla versione del lavoro cui si riferiscono.

## Stato di partenza verificato

- Repository pubblico `emanueledenaro/trama` creato, attualmente senza commit o issue remote.
- Struttura Swift Package Manager, istruzioni di progetto, documentazione iniziale, script di packaging e workflow CI presenti localmente.
- Porting del motore Patto Vivo iniziato in Swift. Mancano app, scanner, adapter Codex e test eseguibili del progetto completo.
- Non sono state eseguite compilazione, prova dell’app, integrazione autenticata o CI remota di Trama.
- Lo ZIP fornito è un prototipo TypeScript di riferimento. I risultati di test che contiene non valgono come verifica del porting Swift.
- Documentazione Codex e GitHub consultata. La disponibilità documentata di un’interfaccia non dimostra ancora che Trama possa completare ogni operazione prevista sull’account e sul repository scelti.

## Scelte fissate dal brief

1. App nativa macOS in SwiftUI, con design system Apple, SF Symbols e tema di sistema.
2. Codex App Server di OpenAI come motore, accesso ChatGPT gestito dal componente ufficiale.
3. Skill AI Hero/Matt Pocock come base del metodo, configurate automaticamente da Trama nel rispetto del progetto esistente.
4. GitHub suggerito nel primo avvio; riuso dei collegamenti effettivamente esposti da Codex e raccomandazioni contestuali per gli altri servizi.
5. Mappa consultabile, navigabile fino alle fonti e continuamente aggiornata.
6. Decisioni versionate, piani modificabili, lavoro isolato e revisione del candidato verificato.
7. Osservazione del lavoro condiviso, interpretazione dell’intenzione tecnica e avvisi su conflitti o incompatibilità.
8. Monitoraggio in background sul Mac dopo attivazione visibile dell’utente.
9. Progetto open source con GitHub Issues come tracker.

## Impostazioni proposte per la prima beta

Queste sono scelte operative reversibili, non nuove richieste all’utente prima di iniziare ogni attività:

- Prima analisi strutturale specifica per SwiftPM. Le altre cartelle restano esplorabili a livello di file; analisi dei linguaggi aggiuntivi da sviluppare esplicitamente.
- Un solo agente di implementazione per sessione. Il monitoraggio del gruppo procede indipendentemente; l’orchestrazione di più implementatori locali viene dopo la prova della sessione singola.
- Sincronizzazione remota tramite letture autenticate condizionali mentre app o helper sono attivi. Un backend di webhook non è un prerequisito della beta locale.
- Osservazione, indice e rivalutazione automatizzati. Pull, rebase, merge, push e pubblicazione sono operazioni distinte, soggette alle regole di autonomia del progetto.
- Skill distribuite a una versione verificata, con aggiornamenti controllati e rollback. Il setup predefinito usa informazioni già disponibili e domanda soltanto in presenza di una vera incompatibilità.
- Nessun passaggio automatico a un provider diverso o a chiamate API con fatturazione separata quando terminano i limiti Codex.

## Il percorso dell’utente

| Passaggio | Cosa vede | Cosa fa Trama | Uscita attesa |
| --- | --- | --- | --- |
| Primo avvio | Finestra nativa, preparazione essenziale e stato dei collegamenti | Verifica componente Codex e stato account senza copiare credenziali | Account riconosciuto oppure accesso ufficiale guidato |
| Collegamenti | ChatGPT e GitHub con stato effettivo, azione Collega quando serve | Scopre capacità accessibili e le verifica; non richiede di nuovo collegamenti già utilizzabili | Repository selezionabile oppure limite preciso e recuperabile |
| Apri progetto | Selettore Apple o repository GitHub da aprire localmente | Legge struttura, remote e configurazione; prepara il metodo per il progetto | Progetto pronto, con riepilogo consultabile della configurazione |
| Crea progetto | Campo per l’idea, nome e cartella, poi struttura proposta | Prepara il piano e genera dopo l’avvio esplicito | Nuovo progetto locale esplorabile |
| Esplora | Mappa, ricerca, albero e dettaglio contestuale | Mantiene indice e fonti aggiornati | Comprensione del modulo e accesso ai file |
| Richiedi | Campo con il contesto del modulo scelto | Usa le skill pertinenti e Codex per analizzare in lettura | Richiesta persistita e piano motivato |
| Decidi | Caso concreto con alternative correggibili | Registra comportamento, esempio, motivazione e versione | Patto aggiornato con dipendenze visibili |
| Avvia | Piano, perimetro e verifiche, poi attività in corso | Lavora in un worktree e gestisce autorizzazioni effettive | Candidato oppure stato di interruzione recuperabile |
| Revisiona | Cosa cambia, scenari, verifiche e diff | Controlla che prove e decisioni riguardino lo stesso candidato | Revisione locale valida o correzioni richieste |
| Pubblica | Destinazione e contenuto dell’operazione GitHub | Esegue solo l’azione autorizzata e riconcilia eventuali retry | PR reale, con CI e merge ancora distinti |
| Segui il gruppo | Novità pertinenti nella mappa e avvisi contestuali | Legge cambiamenti condivisi, confronta gli snapshot, valuta l’impatto | Piano da rivedere, conflitto verificato o semplice attività informativa |
| Torna al progetto | Stato conservato e novità dall’ultimo aggiornamento | Riconcilia il lavoro senza riavviare autonomamente implementazioni | Ripresa consapevole dal punto effettivo |

L’accesso ai collegamenti viene proposto subito. Se l’utente lo rimanda, l’esplorazione locale rimane disponibile; le funzioni che richiedono quel collegamento mostrano il prerequisito. Il setup delle skill specifico del repository avviene dopo che il repository è stato scelto.

## Sequenza di sviluppo

Le sigle T01 e successive sono identificativi del piano, non issue GitHub già pubblicate. Ogni ticket ha una scheda autonoma in [pianificazione](pianificazione/README.md).

| Tappa | Ticket | Prova richiesta per avanzare |
| --- | --- | --- |
| A. App e collegamenti autentici | T01, T02, T03 | App nativa avviabile, login riconosciuto o guidato, repository e PR letti davvero |
| B. Progetto pronto e mappa viva | T04, T05 | Setup ripetibile che preserva le personalizzazioni; una modifica nell’editor aggiorna la mappa |
| C. Richiesta, piano e decisioni | T06, T07 | Piano reale collegato al modulo; cambio decisione che invalida soltanto il lavoro dipendente |
| D. Modifica completa e revisione | T08, T09, T10, T11 | Sessione isolata, prove reali, revisione sul candidato, creazione progetto e PR con azione esplicita |
| E. Consapevolezza del gruppo | T12, T13, T14, T15 | Due copie del progetto producono aggiornamenti, conflitti e avvisi classificati correttamente |
| F. Continuità macOS | T16 | Monitor attivo a finestra chiusa, stop visibile e recupero dopo rete assente o sospensione |
| G. Beta locale riproducibile | T17, T18 | Percorso completo verificato, accessibilità, clone pulito e build Release ripetibile |

Priorità iniziale: T01 rende l’app avviabile; T02 e T03 verificano subito le assunzioni su Codex e GitHub. T05 può procedere mentre si chiudono i collegamenti. Una volta completato T03, T12 può partire insieme al flusso di pianificazione: il monitoraggio non deve aspettare la pubblicazione delle PR di Trama.

La CI macOS minima parte con T01 e accompagna ogni incremento. Il setup locale dipende da Codex ma può completarsi anche rimandando GitHub. Il monitor in background rimane disattivato fino all’attivazione esplicita.

La prima dimostrazione utile termina alla tappa C. La dimostrazione del comportamento distintivo di Trama termina alla tappa E. La prima beta locale richiede anche F e G. Le date si stimano dopo la prova dei collegamenti, non prima.

## Avvenimenti da gestire

| Evento | Reazione richiesta | Criterio di correttezza |
| --- | --- | --- |
| Codex già collegato | Riconoscere l’account e le capacità disponibili | Nessun nuovo OAuth non necessario |
| Codex assente o incompatibile | Percorso di installazione o riparazione | Nessuno stato connesso simulato |
| Login annullato o scaduto | Conservare il passo e offrire un nuovo tentativo | Richiesta e progetto non persi |
| GitHub collegato ma operazione non disponibile | Spiegare la capacità mancante | Collegato non viene confuso con pienamente operativo |
| Setup esistente personalizzato | Integrare soltanto le parti gestite mancanti | Personalizzazioni preservate, niente duplicazioni |
| Nuovo file, rinomina o cancellazione locale | Aggiornare indice, mappa e riferimenti | Risultati precedenti invalidati dove dipendono dal cambiamento |
| Cambio branch durante un’analisi | Ricollegare il contesto e scartare risposte obsolete | Nessun piano attribuito alla versione sbagliata |
| Collega pubblica una modifica estranea | Aggiornare la cronologia | Nessuna interruzione o notifica ripetuta |
| Collega pubblica sullo stesso modulo | Analizzare la sovrapposizione | Attività collegata non etichettata automaticamente come conflitto |
| Conflitto Git riprodotto | Avviso con base, branch e parti in conflitto | Prova isolata, checkout originale intatto |
| Comportamenti forse incompatibili in file diversi | Ipotesi motivata e scenario da verificare | Nessuna promozione automatica da ipotesi a fatto |
| Lavoro già affrontato da una PR altrui | Suggerire riuso o modifica del piano | Collegamenti alle fonti e nessuna cancellazione del lavoro locale |
| Force push, branch eliminato o PR da fork | Riconciliare riferimenti e analisi | Nessun riuso di prove riferite a SHA superati |
| Decisione del Patto modificata | Rivalutare i lavori dipendenti | Quelli indipendenti restano validi |
| Nuove prove o nuovo candidato | Revocare la revisione precedente | Approvazione legata alla versione realmente verificata |
| Conflitto bloccante durante l’esecuzione | Impedire la successiva integrazione e gestire le azioni interessate | Preservare modifiche già eseguite e distinguere stop richiesto da stop confermato |
| Limiti API o limiti di uso dei modelli | Attendere rispettando il servizio, mostrare l’analisi in coda | Nessuna raffica di retry o spesa alternativa automatica |
| Rete assente, Mac sospeso o permessi revocati | Conservare lo stato con ultimo aggiornamento e motivo | Dati vecchi mai presentati come attuali |
| Ritorno online o risveglio | Recuperare differenze e aggregare avvisi | Niente notifiche duplicate o buchi silenziosi |
| Notifiche negate o monitor spento | Avvisi consultabili nell’app e stato del monitor chiaro | Nessuna falsa promessa di aggiornamento continuo |
| Lavoro del collega ancora locale | Dichiararlo non osservabile via GitHub | Nessuna presenza o intenzione inventata |

## Contratto dell’intelligenza di progetto

Il rilevatore osserva differenze reali e accoda solo quelle nuove. Codex interpreta diff e contesto, collega le conseguenze a moduli, richieste e decisioni e restituisce un’analisi con fonti. Un verificatore separato può eseguire scenari sui candidati combinati. L’interfaccia conserva questi livelli distinti:

- Osservato: un branch, un file, uno SHA, una PR o un esito di controllo rilevato.
- Interpretato: un’intenzione tecnica o una conseguenza ricostruita da Codex con fonti.
- Verificato: un conflitto riprodotto o uno scenario eseguito sullo snapshot indicato.
- Non osservabile: contenuto non condiviso, dati non accessibili o parti non analizzate.

Un avviso contiene progetto, fonte, versioni confrontate, conseguenza sul lavoro corrente, stato della prova e azione proposta. La stessa situazione mantiene la stessa identità per evitare duplicati. Nuove evidenze possono modificarla o risolverla.

Lo stato remoto, lo stato del checkout locale e lo stato dell’analisi AI hanno tempi distinti. L’app può avere ricevuto nuovi commit mentre Codex sta ancora valutandoli: in quel caso mostra analisi in corso, non una comprensione già aggiornata.

I contenuti di issue, commit, documenti e repository sono dati da analizzare. Non possono impartire istruzioni per cambiare autorizzazioni, disabilitare controlli o pubblicare informazioni.

## Autonomia e attenzione umana

| Operazione | Comportamento predefinito proposto |
| --- | --- |
| Configurazione iniziale delle skill | Automatica nel progetto scelto; riepilogo e modifiche gestite consultabili |
| Lettura, indice e rilevazione degli aggiornamenti | Automatica sui progetti abilitati |
| Analisi Codex delle novità | Automatica, pertinente, aggregata e soggetta ai limiti concordati |
| Aggiornamento della mappa e invalidazione di prove vecchie | Automatici, con dipendenze esplicite |
| Cambiare una decisione di prodotto | Intervento della persona; conseguenze rese visibili prima dell’applicazione |
| Avviare o riprendere modifiche del codice | Azione esplicita o delega già definita per quel lavoro |
| Permessi di comandi, filesystem e rete | Controlli effettivi del componente e del sistema operativo |
| Modificare branch originali, fare merge, push o pubblicare | Operazioni distinte dal monitor, nel perimetro autorizzato |
| Scrivere ad altri collaboratori | Azione esplicita o politica di squadra stabilita separatamente |
| Avvio al login e monitor a finestra chiusa | Attivazione visibile e revocabile nelle impostazioni |

## Interfaccia, movimento e suono

La finestra principale usa sidebar e toolbar native. La mappa occupa il centro; il dettaglio destro si apre sulla selezione, l’attività compare nel contesto del lavoro. Ricerca e vista ad albero permettono di lavorare senza gesti sul canvas. Aspetto chiaro e scuro seguono il sistema.

Le transizioni mantengono l’orientamento tra progetto, modulo e file. Non c’è un’introduzione animata obbligatoria. Riduci movimento e contrasto vengono rispettati.

Il lavoro ordinario è silenzioso. Le notifiche possono accompagnarsi a un suono discreto per una decisione richiesta o un risultato da revisionare. Suono e notifiche sono disattivabili; gli avvisi rimangono nell’app. La gestione di attenzione e notifiche viene implementata insieme agli avvisi, non aggiunta soltanto alla fine.

## Verifiche e responsabilità

Ogni ticket ha un responsabile di implementazione e una revisione indipendente. Gli agenti paralleli ricevono proprietà separate dei file o lavorano in worktree distinti. La revisione finale confronta sia comportamento richiesto sia convenzioni del progetto.

Le verifiche osservano il comportamento ai confini pubblici: selezione del progetto, protocollo Codex, dati GitHub, Patto Vivo, sessione, evidenze e avvisi. Test di trasporto possono usare fixture registrate e anonimizzate; le prove reali di OAuth, permessi e monitor macOS restano verifiche separate.

Prove obbligatorie del sistema:

1. Primo avvio senza account, con account già disponibile e con collegamento revocato.
2. Setup ripetuto su progetto vuoto e progetto con personalizzazioni.
3. Richiesta, decisione, implementazione e revisione sul medesimo candidato.
4. Modifica della decisione e invalidazione limitata al lavoro dipendente.
5. Due copie del repository: modifica condivisa compatibile, conflitto Git e incompatibilità di comportamento tra file diversi.
6. File locali non committati preservati durante letture e prove di integrazione.
7. Eventi duplicati, in ritardo e fuori ordine, force push, rete assente e risveglio.
8. Limiti dei modelli e del servizio, pausa del monitor, ripresa senza doppie analisi.
9. Percorso completo da tastiera, VoiceOver, tema di sistema e Riduci movimento.
10. Clone pulito, test, build Release e verifica dell’app su un secondo ambiente.

Le fixture semantiche comprendono casi compatibili molto simili a quelli incompatibili. Si misurano falsi avvisi e problemi mancati sui casi controllati; non si promette rilevazione completa di conflitti semantici arbitrari.

## Dopo la prima beta

- Presenza condivisa tra membri del gruppo che usano Trama, per dichiarare intenzioni e perimetri prima del push. Richiede un protocollo di squadra esplicito e non si deduce da GitHub.
- Più agenti locali di implementazione, dopo aver verificato la sessione singola e l’integrazione combinata.
- Analisi specifica di altri linguaggi e ambienti, partendo da JavaScript/TypeScript.
- Monitoraggio remoto con webhook e disponibilità indipendente dal Mac. È un servizio distinto, da progettare e autorizzare.
- Distribuzione scaricabile firmata e notarizzata, con prova di installazione su un altro Mac. La beta compilata dal codice e la distribuzione pubblica sono traguardi separati.

## Rischi da risolvere presto

| Rischio | Ticket che lo affronta | Decisione operativa |
| --- | --- | --- |
| I collegamenti Codex non espongono tutte le operazioni GitHub necessarie | T03 | Verificare le capacità prima del monitor; aggiungere un adapter autorizzato se serve |
| Il setup upstream è interattivo e può scegliere file non letti da Codex | T04 | Integrazione deterministica di Trama, con istruzioni effettivamente lette e verifica del catalogo |
| Un’analisi AI obsoleta arriva dopo un aggiornamento | T06, T12, T14 | Risultati legati a snapshot e scarto delle risposte superate |
| Un’approvazione riguarda un candidato diverso da quello pubblicato | T09, T11 | Verifica della versione immediatamente prima dell’azione |
| Troppe analisi o notifiche rendono il monitor costoso e fastidioso | T15, T16 | Delta, cache, coda limitata, deduplica e politiche di attenzione |
| App chiusa o Mac sospeso crea una falsa promessa di presenza continua | T16 | Stati espliciti, helper autorizzato, checkpoint e riconciliazione |

## Fonti tecniche

Consultate durante la definizione del piano. Le API devono essere provate sulla versione del componente scelta per Trama.

- [AI Hero: catalogo e sequenza delle skill](https://www.aihero.dev/skills).
- [AI Hero: comportamento del setup per repository](https://www.aihero.dev/skills-setup-matt-pocock-skills).
- [Licenza delle skill Matt Pocock](https://github.com/mattpocock/skills/blob/main/LICENSE).
- [Codex App Server: autenticazione, skill e collegamenti](https://learn.chatgpt.com/docs/app-server).
- [Codex: accesso e credenziali](https://learn.chatgpt.com/docs/auth).
- [Codex e GitHub](https://learn.chatgpt.com/docs/third-party/github).
- [GitHub: commit e confronti](https://docs.github.com/en/rest/commits/commits).
- [GitHub: letture condizionali e rispetto dei limiti](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
- [Apple: inspector SwiftUI](https://developer.apple.com/videos/play/wwdc2023/10161/).
- [Apple: SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice).
- [Apple: notarizzazione](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
