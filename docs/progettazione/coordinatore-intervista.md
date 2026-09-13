# Intervista sul Coordinatore generale

Stato: intervista conclusa e approvata. Dopo la simulazione testuale del primo avvio, tutorial e uso quotidiano, Emanuele ha risposto «approvato» e ha richiesto la revisione di ogni ticket e l'esecuzione con Ask Matt sul piano aggiornato. Questo documento registra decisioni di prodotto, non prove di implementazione.

Modalità richiesta dalla persona: una domanda alla volta. Le risposte aggiornano il documento prima della domanda successiva.

## Materiale di partenza

Il brief fornito dalla persona estende la richiesta precedente: un solo Coordinatore generale, team distinti per progetto, miglioramento dei team basato su evidenze e lavoro sul repository di Trama attraverso le stesse verifiche.

Stato locale rilevato: branch `codex/design-completion`, base pubblicata `ad38e76` dopo PR #32. Sono presenti modifiche non committate all'interfaccia per #22. La chat Coordinatore descritta nel brief non è ancora attestata da prove di funzionamento.

## Vincoli già espressi

- Product Owner umano, Coordinatore unico, specialisti scelti in base al progetto senza catalogo chiuso.
- Team, conversazioni, decisioni, candidati ed evidenze appartenenti al rispettivo progetto.
- Preservazione delle funzioni e dei dati esistenti; estensione dell'app nativa Apple.
- Codex ufficiale, accesso ChatGPT, soli modelli OpenAI e nessuna fatturazione API alternativa automatica.
- Scelte di prodotto riservate alla persona; sospensione del lavoro che ne dipende.
- Miglioramenti dei team reversibili e motivati da prove; nessuna modifica ai pesi dei modelli.
- Miglioramenti di Trama soggetti a ticket, isolamento, verifiche e revisione; nessuna sostituzione silenziosa dell'app in uso.
- Continuità locale dichiarata correttamente; cloud 24/7 separato e opzionale.

## Prima tornata: decisioni approvate

Risposta della persona: «tutti i consigliati».

| ID | Decisione | Scelta approvata |
| --- | --- | --- |
| Q1 | Una sola chat e cronologie separate: cosa vede la persona al cambio progetto? | Stessa superficie, cronologia del progetto selezionato; una panoramica Tutti i progetti per riepiloghi e avvisi. |
| Q2 | Cosa succede al lavoro autorizzato del progetto A passando a B? | Prosegue su A nei limiti assegnati; il cambio seleziona il dialogo, non trasferisce o ferma il lavoro. |
| Q3 | Quando l'osservazione di un problema diventa autorizzazione a implementare? | Solo dentro un mandato persistente del Product Owner con obiettivo e limiti; altrimenti proposta e richiesta di mandato. |
| Q4 | Quali informazioni può leggere il Coordinatore in vista globale? | Stati sintetici dei progetti; contenuti e conversazioni di ciascun progetto accessibili solo nel suo contesto o per un confronto richiesto. |
| Q5 | Due cartelle collegate allo stesso repository GitHub sono un progetto o due? | Identità distinte per cartella, come oggi; una nuova copia diventa parte dello stesso progetto soltanto per scelta esplicita. |

## Seconda tornata: autonomia e operatività

Q6 approvata con risposta «ok»: il Coordinatore può lavorare sui ticket concordati, correggere problemi rispetto ai comportamenti già decisi e migliorare test e documentazione entro il mandato. Nuove funzionalità e cambiamenti di comportamento richiedono prima una scelta del Product Owner. L'apertura di un progetto da sola non estende il mandato.

Q7 decisa dalla persona: il Coordinatore valuta le modifiche e può controllare e mergiare autonomamente quelle ordinarie o previste dai ticket, entro il mandato. La persona ha precisato: «casi distruttivi seri chiama me». In quei casi il Coordinatore ferma l'operazione interessata e chiede l'intervento del Product Owner nella chat, mantenendo l'avviso anche con notifiche di sistema negate. Questa decisione sostituisce la raccomandazione iniziale di chiedere un via libera umano per ogni merge. Restano obbligatori verifiche, revisione tecnica distinta dall'autore e rispetto del Patto Vivo. Le scelte di prodotto e le autorizzazioni separate di pubblicazione e distribuzione restano quelle già stabilite.

| ID | Decisione | Esito |
| --- | --- | --- |
| Q6, approvata | Quali attività comprende il mandato iniziale proposto a un nuovo progetto? | Ticket concordati, correzioni che ripristinano comportamenti già decisi, test e documentazione. Nuove funzioni e compromessi visibili richiedono una scelta del Product Owner. |
| Q7, approvata | Chi concede il via libera all'integrazione del candidato? | Il Coordinatore valuta e può mergiare autonomamente modifiche ordinarie o previste dal ticket, entro il mandato e dopo le verifiche. Nei casi distruttivi seri ferma l'operazione e coinvolge il Product Owner. |
| Q8a, approvata | Quanti specialisti possono lavorare simultaneamente? | Lo decide il Coordinatore in base al task: aggiunge specialisti quando dividere il lavoro permette di accelerare il risultato. La proposta di un limite iniziale fisso di due è superata. Restano applicabili dipendenze, isolamento, priorità e risorse disponibili. |
| Q8b, approvata | Chi sceglie il modello di ogni incarico? | Il Coordinatore sceglie il modello degli specialisti tra quelli OpenAI disponibili secondo incarico e limiti del progetto, rendendo visibile la scelta. Il modello della chat principale resta scelto dalla persona. I cambi riguardano nuovi incarichi e non sostituiscono silenziosamente il modello di un'attività avviata. |
| Q9, approvata | Che differenza c'è tra chiusura della finestra ed Esci? | Chiudere la finestra lascia proseguire il lavoro autorizzato; Esci ferma le nuove assegnazioni, richiede l'interruzione controllata degli agenti e conserva lo stato e i worktree per la ripresa. Il monitor, se abilitato, continua a raccogliere novità GitHub. |
| Q10, approvata | Una correzione al perimetro di un agente come influisce sul lavoro già iniziato? | Stop controllato dell'agente e dei soli lavori dipendenti; conservazione delle modifiche già prodotte e ricalcolo del piano prima della ripresa entro il nuovo perimetro. I lavori indipendenti continuano. Nessuna cancellazione automatica dei file esclusi. |
| Q11, chiarita | Cosa significa miglioramento continuo e quando riguarda Trama stessa? | Prima migliorano composizione e metodo dei team. Quando Trama è funzionante, può essere usata per sviluppare il proprio repository con lo stesso processo controllato. La precedente domanda sulla diagnostica dell'interfaccia è ritirata e non costituisce un consenso alla raccolta di schermate. |
| Q12, approvata | Le buone pratiche di un team possono essere proposte ad altri team? | Sì, come metodi generali privi dei contenuti riservati del progetto di origine. Il team destinatario ne verifica l'applicabilità prima di adottarle; nessun trasferimento automatico di codice o decisioni. |
| Q13, approvata | Se Trama resta in esecuzione ma Codex raggiunge temporaneamente i limiti d'uso, come riparte il lavoro? | Attesa visibile e ripresa automatica degli incarichi già autorizzati quando il servizio torna disponibile, previa riconciliazione di candidato, decisioni e perimetro. Nessun provider o pagamento alternativo. Esci e stop espliciti continuano a richiedere una ripresa della persona. |

Q8a decisa dalla persona: «dipende dal task, se rendiamo più veloce il task se aggiungiamo più specialisti allora okay». Il numero di specialisti attivi segue la possibilità di parallelizzare lavoro utile. La presenza di più agenti non è di per sé una prova di accelerazione: motivazioni e risultati devono permettere di valutare tempi, attese e lavoro duplicato. Non viene fissato un nuovo limite numerico in questa intervista.

Q8b approvata con risposta «si»: il Coordinatore sceglie i modelli degli specialisti in base all'incarico e ai limiti del progetto e mostra la scelta. La persona mantiene il selettore del modello della chat principale.

Q9 approvata con risposta «okay consigliato»: chiudere la finestra lascia proseguire il lavoro; Esci ferma gli agenti in modo controllato e conserva tutto per la ripresa. Il monitor abilitato continua a raccogliere novità GitHub. La richiesta di arresto deve restare distinguibile dall'arresto effettivamente confermato. Resta valido il vincolo del brief che vieta al monitor di riavviare automaticamente sessioni di modifica.

Q10 approvata con risposta «consigliato»: restringere il perimetro ferma l'agente coinvolto e i soli lavori dipendenti, conserva quanto prodotto e richiede il ricalcolo del piano prima della ripresa nel nuovo perimetro. I lavori indipendenti continuano. Le evidenze precedenti restano nella cronologia, senza diventare automaticamente valide per il lavoro ricalcolato.

Chiarimento Q11: la persona intende migliorare il team che lavora in Trama, non avviare da questa frase una raccolta automatica di schermate. Ha aggiunto: «poi ovviamente se abbiamo trama funzionante possiamo usare trama per migliorare trama». Il primo obiettivo è rendere efficace il Coordinatore e i team; il lavoro sul repository di Trama segue quando il percorso operativo è funzionante. Questo mantiene il requisito di poter sviluppare Trama tramite Trama, senza anteporre l'auto-miglioramento dell'app al funzionamento del Coordinatore.

Q12 approvata con risposta «consiglio di si»: una buona pratica imparata da un team può essere proposta ai team degli altri progetti. Il trasferimento riguarda il metodo generale, mantenendo separati codice, decisioni e contenuti riservati. Ogni team verifica che il metodo sia utile al proprio progetto prima di adottarlo.

Q13 approvata con risposta «sì» alla domanda sui limiti d'uso. Mentre Trama resta in esecuzione, il Coordinatore attende e riprende gli incarichi già autorizzati quando la capacità torna disponibile. Restano necessarie la riconciliazione degli input e la distinzione rispetto a Stop ed Esci. Non viene introdotto un secondo Coordinatore generale.

## Riscontri nel codice

Esplorazione statica completata, senza eseguire app o test: oggi il cambio progetto salva il documento e interrompe l'attività Codex corrente. ProjectStore gestisce un solo progetto attivo e un solo turno operativo; richieste e Patto sono persistiti per progetto. I worktree sono conservati, ma non costituiscono team persistenti.

La revisione umana è riferita al candidato preciso, con invalidazione delle evidenze obsolete. Il monitor abilitato dopo Esci raccoglie dati GitHub senza eseguire Codex. La persistenza dei progetti distingue le cartelle, mentre il monitor identifica i repository GitHub. Questi fatti rendono necessari confini espliciti per Q2 e Q5.

Fonti: `Sources/Trama/ProjectStore.swift`, `Sources/TramaCore/CodexClient.swift`, `Sources/TramaCore/PactEngine.swift`, `Sources/Trama/SessionWorkflow.swift`, `Sources/TramaMonitor/BackgroundMonitorProcess.swift`, `Sources/TramaCore/MonitorPersistence.swift`.

## Copertura del brief e rami consolidati

| Area del brief | Decisioni e vincoli che la definiscono |
| --- | --- |
| Chat principale e primo avvio | Q1 e Q4: un interlocutore generale, progetto e team attivi visibili, cronologia del progetto e panoramica globale. Il campo di scrittura e il modello scelto dalla persona restano accessibili. |
| Contenuti della chat | Restano richiesti streaming Codex, agenti e motivazioni, incarichi e stato, piani modificabili, domande e decisioni versionate, autorizzazioni, fonti, file, diff, test, revisioni, conflitti, eventi del monitor e risultati bloccati o completati. Sono viste delle entità esistenti, non nuovi esiti dichiarati dal modello. |
| Team dinamici e dettaglio agente | Q8a e Q8b: ruoli liberi, parallelismo utile al task, modelli specialisti scelti dal Coordinatore. Ogni agente conserva identità, motivo, progetto, obiettivo, ticket, perimetro, dipendenze, modello, strumenti, branch, worktree, verifiche, criteri, stato e ultimo aggiornamento. La schermata Team e i collegamenti dalla chat permettono consultazione e controllo. |
| Destinatario delle richieste | Q1, Q4 e Q5: il contesto selezionato è esplicito. Una richiesta su più progetti conserva la separazione dei rispettivi incarichi; un destinatario ambiguo va chiarito prima delle azioni. Bozze e cronologie appartengono al rispettivo progetto. |
| Isolamento e persistenza | Q2, Q4 e Q5: cambiare selezione non trasferisce il lavoro. Cartelle distinte conservano identità, conversazioni, team, Patto, worktree ed evidenze distinti. Collegamenti espliciti non autorizzano fusioni silenziose o cancellazioni di stati esistenti. |
| Autorità di prodotto e merge | Q3, Q6, Q7: obiettivi e compromessi umani; il Coordinatore lavora e integra entro mandato dopo verifiche e revisione indipendente. Casi distruttivi seri richiedono la persona. Nessun agente può disabilitare controlli o registrare una propria valutazione come revisione umana. |
| Concorrenza, risorse e priorità | Q2, Q8a, Q8b, Q13 e brief: la selezione UI non cambia le priorità del Product Owner. Il Coordinatore adatta le assegnazioni alle dipendenze, alle risorse del Mac e ai limiti dei modelli; non esiste una quota fissa di due specialisti. I limiti provocano attesa visibile, senza provider o spesa alternativi. |
| Stop, cambio perimetro e decisioni | Q9 e Q10: distinguere stop richiesto e confermato, conservare gli artefatti, rivalutare i soli dipendenti prima della ripresa. Una scelta di prodotto mancante non può essere indovinata per sbloccare il lavoro. |
| Chiusura, sospensione, offline e monitor | Q9, Q13 e brief: finestra chiusa lascia lavorare l'app; Esci arresta gli agenti. Il monitor locale abilitato osserva e salva checkpoint senza riavviare modifiche. Mac spento o indisponibile non significa operatività; alla disponibilità si riconciliano le fonti e si evita di duplicare gli eventi. |
| Miglioramento del team | Q11, Q12 e brief: cambiamenti reversibili di composizione e metodo motivati da risultati verificati, confrontati con il metodo precedente. Le pratiche generali possono essere proposte ad altri team dopo aver escluso contenuti riservati; adozione verificata dal destinatario. Nessun cambiamento ai pesi dei modelli. |
| Trama sviluppa Trama | Q11: dopo il funzionamento del percorso operativo, il repository di Trama è un progetto su cui lavorare con ticket, worktree, verifiche, revisione e regole di integrazione. Nessuna sostituzione silenziosa dell'app in uso. |
| Avvisi | Brief e Q7: lavoro ordinario silenzioso, notifiche e suoni facoltativi; scelte, autorizzazioni, fallimenti, conflitti e blocchi restano nella chat anche con notifiche negate. I risultati importanti riportano prove e ultimo aggiornamento effettivo. |
| Compatibilità e accettazione | Brief: conservare Mappa, ricerca e albero, richieste, piani, Patto, decisioni e invalidazioni selettive, Codex/ChatGPT, GitHub, worktree, revisione, pubblicazione controllata, monitor, temi, accessibilità, responsive #21 e design #22. Compatibilità dei dati persistiti e regressioni sono criteri bloccanti per ogni integrazione. |
| Sviluppo e consegna | Brief: prima un percorso verticale completo, poi estensione progressiva; ticket autonomi con dipendenze, Ask Matt, TDD sui confini concordati, revisioni Standards e Spec, prova nell'app, CI verde e clone pulito. Presenza di codice da sola non chiude ticket. Firma, notarizzazione e secondo Mac restano necessari per la distribuzione scaricabile. |
| Esclusioni | SwiftUI nativo Apple, niente Electron; solo Codex ufficiale con accesso ChatGPT. Cloud 24/7 separato e opzionale. La domanda ritirata Q11 non autorizza raccolte automatiche di schermate. |

## Passaggio successivo

La conferma finale è arrivata. Sono approvati anche la configurazione guidata facoltativa, il riuso degli accessi effettivi, gli esercizi locali riprendibili per comprendere il progetto, modificare e verificare, decidere e confrontare modifiche in conflitto. La fattibilità tecnica e il comportamento effettivo richiedono implementazione e prove; non sono dedotti dall'accordo sul modello.

L'ADR 0002 registra l'isolamento e la condivisione dei soli metodi generali; l'ADR 0003 registra il merge delegato. Il lavoro riparte dallo stato effettivo e dalle modifiche #22 presenti, preservandole, aggiorna specifica e roadmap del Coordinatore e segue le dipendenze dei ticket. Nessun passaggio di questa intervista chiude il goal della beta.
