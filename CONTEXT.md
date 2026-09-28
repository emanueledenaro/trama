# Dominio di Trama

Trama è un'app macOS per esplorare un repository e collegare una richiesta ai moduli, alle decisioni e alle verifiche che la riguardano.

Un progetto è una cartella locale. Un modulo raggruppa file rilevati in una directory; il raggruppamento non prova una responsabilità architetturale. Una richiesta conserva il modulo selezionato. Un piano descrive modifiche proposte e resta distinguibile dal codice esistente. Il piano di una richiesta è una spec, scritta dal pianificatore con la skill `to-spec` di AI Hero sulla conversazione della richiesta e sulle risposte del chiarimento: prima propone i seam da testare, con il vocabolario di `codebase-design`, e la persona li conferma o li corregge con parole sue; poi scrive la spec con le sezioni del template. Con GitHub collegato la spec diventa una issue con l'etichetta `ready-for-agent`; altrimenti resta in Trama come piano della richiesta. Scritta la spec, il divisore la spezza in fette con la skill `to-tickets`: ogni fetta è un proiettile tracciante verticale, con i criteri di accettazione e le fette che la bloccano. La persona conferma la suddivisione o la corregge con parole sue, e ogni correzione avvia un nuovo giro. Confermate, con GitHub collegato le fette diventano issue in ordine di dipendenza, con la spec come genitore, i blocchi nel testo e come collegamento nativo di GitHub, e l'etichetta `ready-for-agent`; altrimenti restano in Trama come fette del piano.

Una decisione registra un comportamento, un esempio e una motivazione. Ogni modifica della decisione incrementa la sua versione. Una delega collega il lavoro alle versioni delle decisioni e al perimetro ammesso. Un candidato identifica la versione concreta del lavoro. Un'evidenza appartiene a un candidato e a una specifica versione delle verifiche. Una revisione umana riguarda esattamente quel candidato; nuove evidenze o decisioni pertinenti invalidano il via libera.

Il Patto Vivo è questo legame operativo tra decisioni, deleghe e verifiche. Non è una sandbox. I risultati del progetto di esempio verificano esclusivamente i suoi casi locali.

## Lingua

Il codice sorgente e i commit sono in inglese. Le parole rivolte alla persona, inclusi interfaccia, documentazione di prodotto, issue e pull request, sono in italiano. I contenuti persistiti e le fonti esistenti mantengono la loro lingua per non alterare il loro significato.

Nei testi per la persona Trama usa l'italiano semplice del glossario dell'interfaccia (`docs/glossario.md`): nomi al posto degli id, che restano al passaggio del mouse, e parole comuni al posto del gergo. Nell'interfaccia il task in focus si chiama lavoro in primo piano, la focus mode esame approfondito, i seam punti di prova e il worktree copia di lavoro.

### Glossario inglese

Con l'interfaccia in inglese (issue #301) Trama usa queste parole, in un inglese semplice. Ogni termine italiano ha una sola traduzione.

| Italiano | Inglese |
| --- | --- |
| Coordinatore | Coordinator |
| Sviluppatore | Developer |
| Ruoli fissi | Fixed roles |
| Squadre, squadra | Squads, squad |
| Obiettivo | Goal |
| Piano | Plan |
| Fetta | Slice |
| Incarico | Assignment |
| Candidato | Candidate |
| Verifiche, verifica | Checks, check |
| Revisori, revisione | Reviewers, review |
| Esame approfondito | Deep review |
| Punti di prova | Test points |
| Copia di lavoro | Working copy |
| Patto Vivo, Patto | Living Pact, Pact |
| Scheda del Patto | Pact card |
| Decisione | Decision |
| Mandato, mandato di progetto | Mandate, project mandate |
| Via libera | Green light |
| Aspetta te | Waiting for you |
| Attività | Activity |
| Riepilogo | Recap |
| Memoria | Memory |
| Lavoro in primo piano | Work in focus |
| Riga di stato | Status line |
| Prossimo passo | Next step |
| Chiarimento | Clarification |
| Comprensione condivisa | Shared understanding |
| Lavoro continuo | Continuous work |
| Giro | Round |
| Mossa automatica | Automatic move |
| Studio del progetto | Project study |
| Pausa | Pause |
| Domanda dello sviluppatore | Developer question |
| Chat tra agenti | Agent chat |
| Sovrapposizione | Overlap |
| Divergenza del branch | Branch divergence |
| Collegamenti | Connections |
| Impostazioni | Settings |
| Panoramica | Overview |
| Turno | Turn |
| Rilievo, rilievo bloccante | Finding, blocking finding |
| Suggerimento | Suggestion |
| Divieto fisso | Fixed ban |
| Pratica | Practice |
| Presenza | Presence |
| Percorso (Chiedi a Trama) | Route |
| Pianificatore, divisore | Planner, slicer |
| Suddivisione, divisione in fette | Breakdown, splitting into slices |
| Triage, diagnosi, correzione | Triage, diagnosis, fix |
| Revisione dell'architettura | Architecture review |
| Test di regressione | Regression test |
| Proposta | Proposal |
| Lavoro del progetto | Project work |
| Progetto di esempio | Example project |

## Ruoli e coordinamento

Product Owner: la persona che decide obiettivi, priorità, comportamenti del prodotto e compromessi. La responsabilità di queste decisioni resta umana.

Coordinatore generale: l'interlocutore principale della persona per tutti i progetti registrati in Trama. Riunisce lavoro e risultati dei team, mantenendo distinti progetti e decisioni.

Team di progetto: l'insieme degli specialisti appartenenti a un singolo progetto. È sempre completo: ha tutti i ruoli fissi e gli sviluppatori scelti per il progetto. Solo gli sviluppatori dipendono dalle necessità del progetto e cambiano nel tempo. Il team è organizzato in squadre; nell'interfaccia la sua vista si chiama Squadre. È distinto dal Gruppo, che riunisce le persone del repository.

Specialista: un agente con una competenza e un incarico motivato all'interno di un team di progetto. Il ruolo è distinto dal modello AI usato per svolgerlo e non conferisce autorità sulle decisioni del Product Owner.

Ruolo fisso: una figura che ogni team di progetto ha sempre, qualunque sia il progetto: QA, UX, ricerca, documentazione e dominio, bug triage e debugger, revisore della spec, Clean Code, guardiano delle regressioni, sicurezza, prestazioni, DevOps. Ha una competenza, le skill di AI Hero su cui si basa e i suoi momenti. Sicurezza e prestazioni sono aggiunte di Trama e non hanno una skill. Trama crea i ruoli fissi con il progetto e li aggiunge ai progetti esistenti; nessuno li toglie dal team. Non contano nel limite degli sviluppatori in parallelo. Nelle squadre il QA è dedicato a ogni squadra; gli altri ruoli fissi sono ruoli condivisi, che servono tutte le squadre.

Sviluppatore: uno specialista scelto per il progetto, che realizza le fette con `implement` e `tdd`. Il Coordinatore propone gli sviluppatori alla fine dello studio e, senza un mandato di progetto, solo la risposta della persona li crea; con il mandato di progetto li crea da solo nelle squadre e lo notifica. Poi li cambia entro il mandato. La persona può rinominare uno sviluppatore dalla vista Team o chiedendolo al Coordinatore, senza mandato; l'ID resta lo stesso. I ruoli fissi non si rinominano.

Identità di un agente: il bot dell'agente (una forma morbida di tessuto cucito con due punti di cucito per occhi, che si muove secondo lo stato) e il tag del ruolo in breve (`[Interfaccia]`, `[QA]`), nel colore proprio dell'agente. Trama assegna un colore libero da una palette fissa e la persona può cambiarlo dalla vista Team. Il colore sta solo sull'identità: badge e schede usano i colori di stato (ADR 0007).

Momento: il punto del flusso in cui una figura del team interviene: chiarimento e spec, fette, candidato, in sottofondo. In ogni momento la figura ha un compito e le skill che usa lì; una figura può avere più momenti. Il momento dice quando una figura lavora, non che stia lavorando.

Lavoro automatico: il lavoro che Trama avvia da solo per un ruolo fisso, per una regola di Trama e mai per giudizio del modello, solo con un mandato concesso. Il bug triage e debugger smista ogni issue nuova con `triage` e diagnostica con `diagnosing-bugs` una verifica fallita o una regressione; un bug che il ciclo di verifica riproduce diventa una correzione con test di regressione, come incarico dentro il mandato. Clean Code, quando il team è libero dopo aver cambiato il codice, rivede l'architettura con `improve-codebase-architecture`: le proposte arrivano alla persona come scheda del Patto, mai come modifiche. Ogni sessione usa il testo originale della skill ed è in sola lettura, tranne la correzione; l'esito resta registrato nell'incarico.

Provider: il programma esterno con cui Trama parla per far lavorare un agente, per esempio Codex o Claude Agent. È distinto dal modello, che è una scelta interna al provider, e dal ruolo dello specialista, che non dipende da nessuno dei due. Un provider è collegato quando la persona ha reso disponibile il suo account.

Selezione del composer: il provider, il modello e le opzioni del provider scelti per i prossimi turni della chat del Coordinatore. Resta associata alla bozza e alla chat, è una sola per progetto qualunque sia il filtro di obiettivo, conserva preferenze separate per provider e viene fotografata quando un turno entra in coda.

Attribuzione del turno: il provider e il modello che hanno effettivamente eseguito un turno. È distinta dalla selezione mostrata nel composer; una differenza viene conservata e resa visibile.

Stato di accesso: la condizione di un provider rispetto all'account della persona: autenticato, non autenticato o sconosciuto. È distinto dall'essere collegato, perché un provider collegato può essere non autenticato, per esempio dopo la scadenza di un token.

Chiarimento (grilling): i turni di domande con cui il Coordinatore chiarisce una richiesta prima che diventi un piano o un incarico, secondo la skill `grilling` di AI Hero. Ogni turno pone la frontiera, cioè le sole decisioni che si possono già chiedere, come schede di decisione numerate con la risposta consigliata. I fatti il Coordinatore li cerca da solo. Il piano parte quando nessuna domanda del chiarimento è aperta e la comprensione condivisa è confermata: dalla persona, oppure dal Coordinatore quando il mandato di progetto lo copre, che lo notifica e accetta una correzione della persona; una domanda ritirata non è aperta. Una domanda informativa non passa dal chiarimento.

Domanda ritirata: una domanda di decisione, anche di un turno di chiarimento, che la persona chiude senza rispondere e con un motivo. Resta nella cronologia, non diventa una decisione e non blocca più il turno successivo né il piano. Il Coordinatore riceve il ritiro e il motivo come messaggio della persona, nel dialogo in cui aveva posto la domanda. Una domanda con risposta non si ritira: la decisione presa resta e si rivede con una decisione nuova.

Incarico: un lavoro assegnato dal Coordinatore a uno specialista, con obiettivo, perimetro, dipendenze e verifiche richieste. Un incarico produce candidati; la delega è il legame tra quell'incarico, le decisioni applicabili e il mandato.

Contratto dell'incarico: quello che ogni incarico porta allo sviluppatore, obbligatorio: obiettivo, seam da testare, decisioni del Patto su cui si basa, verifiche richieste e dipendenze. Per una fetta i seam sono quelli confermati dalla persona nella spec, indicati con il loro numero. Una lista vuota vale solo se lo dice: nessuna decisione, nessuna dipendenza. Trama rifiuta un incarico con il contratto incompleto. Un lavoro con modifiche ha almeno una verifica e almeno un seam, salvo una fetta la cui spec non ha seam confermati.

Rapporto dello sviluppatore: il rapporto strutturato con cui lo sviluppatore chiude l'incarico: file toccati, test scritti, seam coperti, dubbi. Trama lo salva sull'incarico e lo mostra nella sua scheda. È una dichiarazione dello sviluppatore, mai un'evidenza: contano le verifiche eseguite da Trama.

Domanda dello sviluppatore: il dubbio che uno sviluppatore pone al Coordinatore durante un incarico con lo strumento `ask_coordinator`, quando codice, spec, contratto e decisioni del Patto non lo sciolgono. Alla fine del turno l'incarico va in pausa e la domanda resta anche tra i dubbi del rapporto. Rispondere è la prima mossa del Coordinatore: risponde dai fatti, citando le fonti, oppure mette la domanda su una scheda del Patto che blocca il lavoro, se la risposta è una scelta di prodotto non ancora decisa. La scheda blocca solo quella fetta: il team passa alle fette pronte. Con la risposta, o con il ritiro della scheda, Trama riprende l'incarico nella stessa sessione, appena lo sviluppatore è libero e i limiti delle squadre lo consentono.

Chat tra agenti: la conversazione in cui gli agenti di un lavoro si parlano, sempre visibile e registrata nel progetto, mai privata. Ce n'è una per tipo e per incarico: lo sviluppatore e il Coordinatore sulla domanda dello sviluppatore, lo sviluppatore e i revisori del candidato sui loro rilievi (scrive solo chi ha rilievi), lo sviluppatore e il guardiano delle regressioni su una verifica che passa sulla base e fallisce sul candidato. Ogni messaggio porta il suo autore. La persona le legge in sola lettura dalla scheda dello specialista, che le elenca tutte, e dai collegamenti nella scheda dell'incarico; non stanno nella barra laterale. La persona parla solo con il Coordinatore: se vuole dire qualcosa a un agente lo dice a lui, che lo inoltra (Q32 della specifica #239).

Fase del lavoro: il punto in cui si trova il lavoro di una richiesta, ricavato da Trama dai dati e mai dal modello: chiarimento, spec, fette, esecuzione, verifica, candidato, unito, oppure bloccata con il motivo. Il lavoro di una richiesta comprende i messaggi dello stesso dialogo dal chiarimento che l'ha aperto, o dall'inizio del dialogo, fino a quella richiesta. La fase fette va dalla spec scritta alla prima fetta assegnata. Una fetta è pronta quando tutte le fette che la bloccano sono fatte; è fatta quando il suo candidato ha superato verifiche e revisione tecnica, o la sua pull request è unita. Trama assegna agli sviluppatori solo fette pronte, una per incarico, entro i limiti delle squadre. Un piano scritto prima delle fette si rivede e si assegna intero.

Prossimo passo: la sola mossa, tra quelle che la fase consente, con cui il Coordinatore chiude un turno sul lavoro, con una riga di motivo. La mossa spetta alla persona (rispondere alle domande, confermare la comprensione, concedere il mandato, confermare il team, rivedere il piano, verificare il candidato, unire la pull request) o al Coordinatore (preparare il piano, assegnare il lavoro, eseguire le verifiche). Con il mandato di progetto il Coordinatore fa da solo anche le mosse della persona che il mandato copre: confermare la comprensione, confermare il team, rivedere il piano e unire un candidato con il suo via libera. Restano alla persona le decisioni di prodotto, il mandato, i casi distruttivi seri e i candidati che cambiano l'interfaccia. Trama rifiuta una mossa non consentita e mostra il passo come un pulsante a destra sotto l'ultima risposta, finché resta consentito. Dopo un saluto o una domanda informativa non c'è un prossimo passo. La conferma della comprensione conta solo quando la persona usa il pulsante del passo, o quando il Coordinatore la conferma dentro il mandato; una domanda posta dopo ne chiede una nuova.

Lavoro continuo: il Coordinatore sempre attivo finché un progetto ha lavori aperti e Trama è aperta, anche sui progetti in secondo piano. Dentro il mandato di progetto fa da solo tutto il ciclo: conferma della comprensione, squadre, spec, fette, assegnazione, verifica e unione del candidato con il suo via libera; risolve da solo i blocchi tecnici (conflitti, verifiche rosse, incarichi fermi) e avvisa a cose fatte. Alla persona restano le decisioni di prodotto, il mandato, i casi distruttivi seri, i candidati che cambiano l'interfaccia e il lavoro nuovo, che il Coordinatore propone come obiettivo. Si muove in due modi: reagisce agli eventi che cambiano il lavoro (fine di un turno, di un piano o di un incarico, verifica rossa, conflitto tra worktree, issue nuova, pull request commentata) e fa un giro periodico che rilegge lo stato, sblocca e prepara il passo successivo. Senza lavori aperti non gira. Non ha un limite di mosse di fila né un freno sul consumo: lo ferma la Pausa della persona, sempre raggiungibile, o il limite del provider: finché dura non partono mosse, giri né turni nuovi, la riga di stato dice cosa aspetta e fino a quando se il provider lo dice, e alla fine riprende da solo. Alla riapertura di Trama, con il mandato concesso e fuori pausa, riprende dal passo registrato: il turno del Coordinatore e gli incarichi fermati dalla chiusura, dopo aver controllato cosa era già fatto. Ogni scelta resta visibile e reversibile: i passi della persona che il Coordinatore fa da solo (comprensione, team, seam, fette) vanno in Attività e nel riepilogo, e la persona li corregge da Attività con parole sue; la correzione è registrata e il lavoro riparte da quel passo. Senza mandato, fuori dal suo perimetro, in Pausa o con il lavoro continuo spento, quei passi restano della persona. Un incarico fallito è un blocco tecnico; un incarico fermato da qualcuno no. Un obiettivo proposto non riceve incarichi finché la persona non lo conferma. Da evitare: modalità automatica, pilota automatico.

Giro: un passaggio periodico del Coordinatore su un progetto con lavori aperti, senza un evento che lo avvii. Rilegge lo stato, sblocca quello che può, prepara il passo successivo e fa lo stand-up delle squadre. Un giro che non trova niente da fare non apre turni del provider.

Pausa: il comando della persona che ferma il lavoro continuo di un progetto. In pausa nessuna mossa automatica, nessun giro e nessun lavoro automatico partono; i turni in corso finiscono e il lavoro resta com'era. Riprende solo con un comando della persona. La pausa resta anche dopo la chiusura e la riapertura di Trama.

Task in focus: il lavoro su cui il progetto si concentra ora, mostrato in cima alla chat con la sua fase e con quello che lo blocca o che aspetta dalla persona. Un task è il lavoro di un obiettivo aperto o il lavoro del progetto fuori dagli obiettivi; un obiettivo solo proposto dal Coordinatore non è un task finché la persona non lo conferma. Un solo task è in focus per progetto, gli altri stanno nella coda, prima quelli già avviati. Trama ricava dai dati quali task sono aperti e in che fase sono; la persona sceglie il task in focus e mette in pausa gli altri. Quando il task in focus si chiude (lavoro unito, obiettivo raggiunto, abbandonato o archiviato) o va in pausa, il focus passa al task successivo della coda. A ogni turno il Coordinatore legge il task in focus e la coda, e riporta sul task in focus una conversazione che se ne allontana.

Mossa automatica: un turno del Coordinatore avviato da Trama con il lavoro continuo, dopo un evento o in un giro. Si registra in Attività con il nome della mossa, l'ora e l'esito, non in chat e mai come un messaggio della persona. In chat restano la risposta del Coordinatore, le schede che la mossa produce e un eventuale errore. Finché il turno lavora, la riga di stato lo mostra con il pulsante Ferma. Una mossa fermata resta interrotta e non ne parte un'altra.

Domanda di conferma generica: una risposta del Coordinatore che chiude chiedendo il permesso di andare avanti ("Vuoi che...?", "Procedo?", "Fammi sapere se..."). Trama la riconosce dal testo, senza il modello, e al turno successivo dello stesso dialogo lo dice al Coordinatore. La cronologia registra il richiamo.

Studio del progetto: la conoscenza che il Coordinatore ha del progetto attivo prima di dialogare: codice e moduli, documenti, issue e pull request, decisioni, mandato, incarichi e candidati, eventi del monitor e cronologia della chat. Lo studio avviene all'apertura del progetto e si aggiorna quando il progetto cambia.

Memoria del Coordinatore: le note che il Coordinatore conserva per un progetto oltre la durata della sua finestra di contesto. È distinta dallo studio, che Trama ricava dai dati, e dalla cronologia, che è la conversazione stessa. Ha due parti con un limite di caratteri: le note sul progetto (`MEMORY.md`) e il profilo della persona (`USER.md`), comune ai suoi progetti. Sono note del Coordinatore, non decisioni: non sostituiscono il Patto né il mandato (ADR 0014).

Skill appresa: una procedura che il Coordinatore ha ricavato dal lavoro di un progetto e carica quando serve. Resta nella cartella di Trama, nella libreria di quel progetto. È distinta dalle skill del repository, come quelle di AI Hero, e da una pratica, che è un metodo generale condiviso fra progetti solo con l'adozione della persona. Una skill creata dalla revisione dell'esperienza è curata dal manutentore; una skill nata in un turno con la persona resta sua, salvo che lei la affidi.

Revisione dell'esperienza: la sessione separata e non presidiata che, dopo abbastanza messaggi o azioni, rilegge la conversazione e aggiorna memoria e skill. Può solo aggiungere alla memoria: cambiare o togliere una voce diventa una proposta per la persona. Ogni revisione è registrata con motivo di avvio, esito, chiamate e token.

Manutenzione delle skill: il controllo settimanale che rende inattive e poi archivia le skill create dalla revisione e non usate. Non tocca le skill fissate né quelle della persona; un'archiviazione si annulla con un ripristino.

Scheda: un atto del metodo mostrato nella conversazione: studio, proposta di team, mandato, incarico, decisione, candidato, conflitto, avviso di contesto. Le mosse automatiche stanno in Attività, non in chat. Una scheda non è un log di strumenti né un messaggio libero.

Ispettore: la superficie che mostra il dettaglio di ciò che la persona tocca nella conversazione o nella sidebar: decisione, candidato, specialista, modulo, issue, gruppo. Non è una sezione da visitare a sé. Con l'ADR 0018 l'ispettore esce dalla finestra: le viste vanno nella barra laterale e il dettaglio in una scheda dell'editor.

Progetto attivo: il progetto cui si riferisce la chat aperta con il Coordinatore. È distinto dai progetti che hanno lavoro in corso.

Presenza: chi lavora su cosa nel team di un repository, persone e agenti di Trama nello stesso quadro. Per tutti vengono da GitHub branch, pull request e commit; chi usa Trama condivide in più il branch attivo, gli altri branch su cui lavora, i percorsi dei file toccati (mai il contenuto), la richiesta o l'obiettivo in corso e da quanto, con i propri agenti. La presenza passa per git in `refs/trama/presence/<utente>` sul remoto del progetto (ADR 0015): chi ha il push condivide, chi ha solo la lettura vede, senza remoto resta locale. Si condivide solo con il consenso della persona, dato per progetto e sospendibile con una pausa. Si aggiorna ogni 45 secondi e al cambio di branch; dopo 10 minuti senza modifiche è inattiva, dopo la chiusura mostra quando la persona è stata vista l'ultima volta, dopo 7 giorni sparisce. È un'informazione per coordinarsi, non un'evidenza di verifica.

Sovrapposizione: l'incontro tra il lavoro della persona (checkout, agenti, candidati non ancora uniti, moduli di un task non ancora iniziato) e la presenza dei colleghi, a tre livelli. Stesso modulo della mappa è un segnale leggero; stesso file è un avviso; conflitto è una prova di unione che fallisce, con i file e le righe. Trama la segna nella mappa e nella barra di focus, il Coordinatore la dice in chat una volta, e Trama prepara il messaggio al collega: commento sulla sua pull request se c'è, altrimenti testo da copiare. Il messaggio parte solo se lo invia la persona. Una sovrapposizione non blocca mai il lavoro.

Candidato superato: un candidato sostituito da un lavoro più recente: un candidato nuovo dello stesso incarico, oppure un incarico successivo sulla stessa fetta o, fuori dalle fette, sulla stessa issue. Un altro lavoro sugli stessi moduli non lo sostituisce. Non si unisce e non entra in conflitto con nessuno. Un conflitto tra sviluppatori si segnala solo tra candidati di incarichi diversi ancora aperti.

Divergenza del branch: il branch del progetto e il branch principale su GitHub hanno commit che l'altro non ha, e la loro unione lascia file in conflitto. Trama la dice una volta, come avviso del progetto sopra la chat, con i file a richiesta e la domanda per il Coordinatore su come riallinearli dentro il mandato. Non la ripete su ogni candidato costruito su quel branch. Un collega è una persona reale che condivide la presenza: il branch principale e le pull request non sono colleghi. Con l'ADR 0018 l'avviso sopra la chat lascia il posto al conflitto nella barra di stato e alla riga del branch, con i file, nella vista Lavoro.

Obiettivo: un risultato di progetto con identità stabile, un titolo, il risultato atteso ed esempi verificabili, accettati (deve succedere) o rifiutati (non deve succedere). È distinto da un messaggio, da un incarico e da un candidato: incarichi, candidati e decisioni vi si collegano con identificativi espliciti, mai per deduzione. Lo stato è proposto, aperto, raggiunto o abbandonato; un obiettivo proposto dal Coordinatore resta tale finché la persona non lo conferma. Creare o confermare un obiettivo non concede un mandato e non avvia specialisti.

Obiettivo archiviato: un obiettivo che la persona ha tolto dagli obiettivi di lavoro, cioè dalla barra laterale e dalla panoramica. Archiviare non è uno stato: l'obiettivo conserva lo stato che aveva, gli esempi, le decisioni collegate e la sua cronologia nella chat, che resta consultabile. È distinto da abbandonato, che dice che il risultato non si persegue più; un obiettivo raggiunto si può archiviare e resta raggiunto. Il ripristino lo rimette tra gli obiettivi di lavoro com'era. Un obiettivo con lavoro in corso non si archivia.

Eliminazione: si elimina solo ciò che non ha storia. Un obiettivo senza storia nella chat, cioè senza messaggi, domande, decisioni, incarichi, candidati né schede oltre a quella con cui la persona l'ha creato, si elimina; un obiettivo con storia si archivia. Un messaggio in coda si elimina finché non è partito, salvo quando riferisce al Coordinatore una scelta già registrata, come una risposta, un ritiro o un mandato. Decisioni prese e cronologia non si eliminano.

Osservazione di un esempio: la persona segna un esempio dell'obiettivo come osservato o non osservato su un candidato preciso. Vale solo per quella versione del candidato e per quel testo dell'esempio; un'altra versione o un testo cambiato la rendono storica. Non è un'evidenza delle verifiche.

Chat del Coordinatore: l'unica conversazione della persona con il Coordinatore in un progetto. Contiene tutto: messaggi, domande, schede, mandato, riepiloghi e la conversazione storica cui non è stato attribuito un obiettivo. Ha un solo composer, con una bozza e una selezione. Agenti e squadre non hanno una chat con la persona: la voce di un agente apre la sua scheda; per dire qualcosa a un agente la persona lo dice al Coordinatore (U01). Sostituisce il dialogo del progetto.

Filtro di obiettivo: la vista della chat del Coordinatore ristretta a un obiettivo: i suoi messaggi ed eventi e la scheda che lo ha proposto. Si sceglie sopra la chat o dalla barra laterale; senza filtro la chat mostra tutto, con l'obiettivo accanto ai messaggi che lo riguardano. Ogni messaggio porta l'obiettivo del filtro attivo all'invio, e gli eventi, le domande e gli incarichi nati da quel turno lo ereditano; cambiare filtro non sposta nulla. La sessione tecnica del Coordinatore resta una per progetto: il turno di un messaggio con un obiettivo riceve titolo, risultato atteso ed esempi dell'obiettivo. Sostituisce il dialogo di obiettivo, che aveva bozza e composer propri (U01, ADR 0013). All'apertura di un progetto scritto prima, le bozze dei dialoghi di obiettivo confluiscono nella bozza della chat.

Piano superato: un piano di un obiettivo sostituito da un piano più recente dello stesso obiettivo. Un obiettivo ha un solo piano attivo; quello superato resta nella cronologia con il riferimento al nuovo e senza azioni.

Mandato di progetto: l'autorizzazione persistente del Product Owner al Coordinatore per tutto il ciclo di lavoro di un progetto. Il Coordinatore lo propone all'apertura del progetto: quando il progetto non ha un mandato in vigore né una richiesta in attesa, Trama mette in "Aspetta te" la proposta con tutti i moduli e tutte le azioni delegabili, per regola e senza un turno del modello. Dopo un rifiuto non la ripropone, finché un nuovo mandato non viene revocato. La persona lo concede una volta e può restringerlo in ogni momento dalla vista Mandato: la restrizione toglie moduli o azioni senza revocarlo, crea una nuova versione nella cronologia e vale dal turno successivo del Coordinatore. Qualunque mandato esclude sempre i divieti fissi. La delega di un singolo incarico deve rientrare nel mandato e nelle decisioni applicabili. Da evitare: permesso, autorizzazione generica.

Divieti fissi: le azioni che nessun mandato concede e che restano alla persona: operazioni distruttive su git (force push, push diretto sul branch principale, cancellazione di branch o tag), rilasci e tag, segreti e credenziali, impostazioni del repository. Non si tolgono né si allargano dalle impostazioni; quando il lavoro ne richiede una, il Coordinatore si ferma e la mette in "Aspetta te". Trama li applica come regole nei punti in cui un'azione parte: i comandi e i file degli agenti del Coordinatore e degli specialisti, e i push di Trama. L'azione viene rifiutata prima di partire e diventa una voce di "Aspetta te" con il motivo, finché la persona non la segna come vista. Valgono anche per i mandati concessi prima, senza migrazione.

Proposta di mandato: una richiesta di mandato del Coordinatore che aspetta la persona. Se c'è un mandato in vigore, la scheda mostra cosa cambierebbe: moduli, azioni, obiettivi, priorità e limiti aggiunti o tolti, e i lavori in corso che si fermerebbero. La persona la concede, la corregge o la rifiuta; rifiutarla non tocca il mandato in vigore e non ferma lavori. Revocare il mandato in vigore è un atto distinto: si fa solo dalla vista Mandato, con il motivo e una conferma che mostra i lavori che si fermano (U03).

Richiesta di mandato superata: una richiesta di mandato del Coordinatore ancora in attesa, sostituita da una richiesta più recente prima che la persona rispondesse. Resta nella cronologia, grigia e con il riferimento alla richiesta nuova, ma non si può più concedere. In ogni momento la persona concede al massimo una richiesta, la più recente (W14).

Panoramica globale: il riepilogo di avanzamento, blocchi e decisioni richieste dei progetti registrati. È distinta dalle conversazioni e dai contenuti privati dei singoli progetti. Ordina i progetti per attenzione: decisioni richieste, lavoro fermo o fallito, risultati da approvare, lavoro in corso. Distingue i dati aggiornati dei progetti in memoria dai dati dell'ultimo salvataggio e dagli stati non leggibili, e non apre sessioni AI per aggiornarsi.

Revisione tecnica: la valutazione di un candidato da parte di un revisore distinto dall'autore, riferita ai requisiti e alle verifiche di quel lavoro. Non è una decisione di prodotto né una revisione umana.

Cancello del candidato: il passaggio che un candidato supera prima di arrivare alla persona. Trama esegue prima le verifiche richieste che mancano; poi tutti i revisori del momento candidato lavorano in parallelo sul diff: revisore della spec, Clean Code con la revisione tecnica, guardiano delle regressioni, sicurezza, prestazioni, UX, DevOps, documentazione. Il guardiano esegue la suite del candidato sulla sua base e confronta i risultati: un test che passava e ora fallisce è una regressione. Chi non ha rilievi firma "Niente da segnalare". Una regressione o un rilievo bloccante ferma il candidato; un rilievo bloccante torna allo sviluppatore, che riprende il lavoro nel suo worktree, oppure alla prima occasione se in quel momento non può. Solo un cancello superato lascia arrivare il candidato alla persona: in corso, fallito o bloccato, lo ferma. Se una verifica fallisce, i revisori del diff non partono e la diagnosi passa al debugger. Se Trama trova un segreto nel diff, nessun modello riceve il diff: il rilievo di sicurezza è di Trama. I rilievi sono giudizi del modello; verifiche e confronto della suite sono evidenze.

Focus mode: l'esame in sola lettura di un solo bersaglio, per ora un candidato. Il punto fisso è la base del candidato. Trama esegue prima le verifiche reali nella sandbox, poi i due assi della skill `code-review`, Standards e Spec, in due sessioni parallele con il testo originale della skill. Senza una spec l'asse Spec non parte e riporta "no spec available". Il rapporto tiene le verifiche in testa e i due assi separati, resta nel progetto e si riapre dopo un riavvio. Le verifiche sono evidenze; i rilievi degli assi sono giudizi del modello, ognuno con la sua prova.

Verifica dei rilievi: ogni rilievo di un asse porta una prova, cioè una riga di un file (`file:riga` con il testo citato), un comando che fallisce o una riproduzione. Trama ricontrolla le prove che può eseguire: legge la riga nel worktree del candidato, senza segreti né collegamenti simbolici, e controlla che contenga il testo citato; per un comando guarda se è una delle proprie verifiche di quell'esame, senza argomenti aggiunti, e se è fallita davvero; Trama non esegue comandi scelti da un modello. Lo stato di un rilievo è uno di tre: "verificato da Trama" quando la prova regge; "confermato da un secondo modello" quando il rilievo è grave, Trama non può ricontrollare la prova e il modello del Coordinatore, che non è leggero mentre quello degli assi lo è, lo conferma leggendo il worktree; "ipotesi" in tutti gli altri casi, compresi un rilievo senza prova, una prova smentita e un rilievo grave senza un modello più forte disponibile. Nessun rilievo è verificato senza una prova.

Via libera del Coordinatore: l'autorizzazione all'integrazione di un candidato verificato entro il mandato del Product Owner. Con il via libera il Coordinatore unisce il candidato da solo, salvo che cambi l'interfaccia: allora il candidato va in "Aspetta te" con le schermate prima e dopo, in chiaro e in scuro, e si unisce dopo l'ok della persona. È distinta dal via libera umano; i casi distruttivi seri richiedono l'intervento della persona.

Unione del candidato: Trama porta sul branch principale un candidato verificato, con il cancello dei revisori superato sulla sua versione e il via libera del Coordinatore dentro il mandato (`integrateCandidate` sui suoi moduli). Pubblica il candidato come pull request, rispettando lo standard di pubblicazione e il mandato per il push, e unisce la pull request con un commit di merge, sul commit che ha pubblicato: il branch principale non riceve mai un push diretto. Aspetta che finiscano le verifiche della pull request su GitHub, non chiede mai di scavalcare le protezioni del branch e riprova dopo qualche minuto un'unione che GitHub rifiuta. Un candidato cambiato dopo il via libera o dopo l'ok non si unisce con quelli vecchi: via libera e ok valgono per la versione precisa del candidato. Un'unione che richiederebbe un divieto fisso (il branch del candidato è quello principale, il candidato tocca segreti o impostazioni del repository) si ferma e diventa una voce di "Aspetta te". Senza un remoto GitHub, o con un mandato che non copre l'integrazione, il candidato resta alla persona, che lo rivede e lo pubblica. L'unione va in Attività e, come traguardo, nel riepilogo.

Candidato di interfaccia: un candidato che cambia l'interfaccia. Trama lo riconosce dai file toccati, con regole sue e mai con il giudizio del modello: componenti, markup, stili, viste, le cartelle dell'interfaccia e le sue immagini, esclusi test, documentazione e dati. Non si unisce da solo: arriva in "Aspetta te" con le schermate prima e dopo, in chiaro e in scuro, e si unisce con l'ok della persona. Un rifiuto con motivo torna allo sviluppatore come rilievo, nella stessa sessione e nello stesso worktree; la correzione è un nuovo candidato.

Schermate prima e dopo: le immagini di un candidato di interfaccia sulla sua base e sul candidato, ciascuna in chiaro e in scuro. Trama non sa come ogni progetto disegna le sue schermate, quindi lo dice il progetto: lo script `screenshots` del suo `package.json` salva file PNG nella cartella `TRAMA_SCREENSHOTS_DIR`, nel tema `TRAMA_THEME` (`light` o `dark`). Trama lo esegue nella sua sandbox, come le verifiche, e conserva le immagini nella sua cartella. Valgono per una sola versione del candidato. Senza lo script il candidato aspetta lo stesso la persona, e la scheda dice perché non ci sono schermate. Le schermate non sono un'evidenza delle verifiche.

Messaggio di commit di Trama: il messaggio con cui Trama scrive un candidato nel repository del progetto. Segue le regole che il progetto dichiara in `AGENTS.md`, `CONTRIBUTING.md` o nella configurazione di commitlint; se il progetto non ne dichiara, segue Conventional Commits 1.0.0: `<tipo>[ambito]: <descrizione>`, il perché nel corpo, `Refs: #N` e `Trama-Candidate` nel footer. Trama deduce tipo e ambito dal lavoro, dai file e dai moduli; il Coordinatore li può correggere. Un messaggio non valido viene rifiutato prima del commit. Il titolo della pull request è il titolo del commit. Da evitare: titolo dell'incarico come commit.

Branch di lavoro: il branch del worktree in cui uno sviluppatore lavora. Segue la convenzione del progetto oppure Conventional Branch: `feature/`, `bugfix/`, `hotfix/`, `release/` o `chore/`, poi `issue-N-` quando il lavoro ha una issue e una descrizione breve con minuscole, cifre e trattini. Termina con `-trama-` e un identificativo, che lo rende riconoscibile come lavoro di Trama e unico. Trama lo convalida prima di crearlo. I branch `trama/` creati prima restano riconosciuti.

Standard di pubblicazione: le condizioni che un candidato rispetta prima che Trama apra la pull request: è verificato, il messaggio di commit è valido, non contiene segreti né file sensibili, `git diff --check` è pulito, la issue è collegata quando esiste, nessuna domanda del Patto è rimasta aperta e il mandato permette di aprire pull request. La scheda del candidato mostra ogni condizione, quelle che mancano e come sistemarle. Non sostituisce la revisione della persona.

Push: l'invio di un branch al remoto del progetto. Lo fa solo Trama, quando pubblica un candidato, e solo se il mandato concesso permette di aprire pull request, anche quando lo chiede la persona. Ogni push, fermato, riuscito o non riuscito, resta come evento nella conversazione. Gli agenti non pubblicano: il loro sandbox non ha rete e un loro `git push` viene fermato e registrato come errore. La presenza scrive solo nei riferimenti `refs/trama/presence/`, mai in un branch (ADR 0015).

Miglioramento del team: un cambiamento della composizione o del metodo di lavoro degli specialisti, motivato dai risultati osservati e verificabile rispetto al metodo precedente. Comprende ruoli, istruzioni, modelli disponibili e procedure; conserva le decisioni e i controlli del progetto.

Sessione cloud: il lavoro di un incarico di sviluppo eseguito da un provider sui suoi server invece che in un worktree locale sul Mac. Solo Claude (sessioni cloud di Claude Code) e Codex (Codex Cloud) la offrono. Continua anche con Trama chiusa. Il suo risultato torna come candidato dell'incarico: con Claude la pull request in bozza che la sessione apre sul suo branch, con Codex il diff applicato in un worktree locale. Poi segue il flusso di ogni candidato, con le verifiche di Trama sul Mac. Conta nei limiti degli sviluppatori in parallelo come un incarico locale. Da evitare: remoto, sandbox.

Luogo di lavoro dell'incarico: dove gira un incarico di sviluppo, in locale o in una sessione cloud. Lo decide un'impostazione del progetto: Automatico (predefinita, il Coordinatore sceglie per tipo di lavoro e dice perché nella scheda dell'incarico), Sempre in locale, Cloud quando possibile. La persona sposta un singolo incarico tra locale e cloud prima dell'avvio o a una ripresa. Il Coordinatore, i ruoli in sola lettura, le prove dal vivo e la verifica finale del candidato restano sempre in locale. Quando il cloud non si può usare l'incarico gira in locale e la scheda dice perché e come abilitarlo. Il cloud non è mai obbligatorio.

## Squadre Scrum

Squadra: un gruppo stabile di specialisti che si prende il lavoro di un'area del prodotto, ricavata dalle aree della Mappa (per esempio Catalogo, Checkout, Admin). Ha un capo squadra, almeno uno sviluppatore e un QA dedicato, e accumula nel tempo la sua memoria e le sue pratiche. Il Coordinatore crea le squadre dopo lo studio e lo notifica; la persona può rinominarle, unirle o dividerle. I limiti degli sviluppatori per squadra e delle squadre attive insieme per progetto sono impostazioni del progetto, con tre come valore predefinito per entrambi. Da evitare: team (per la squadra), gruppo.

Capo squadra: lo specialista che fa da Scrum Master della sua squadra: divide il lavoro dell'area in fette, conduce stand-up, stime e retrospettive e si sincronizza con gli altri capi squadra. Risponde al Coordinatore, che dirige tutte le squadre; non decide il prodotto né allarga il mandato.

Ruolo condiviso: un ruolo fisso che non appartiene a una squadra e serve tutte le squadre del progetto: sicurezza, prestazioni, DevOps, documentazione, Clean Code, revisore della spec, guardiano delle regressioni, UX, ricerca, bug triage.

Missione: il lavoro di un obiettivo che tocca più aree e quindi più squadre. Il Coordinatore la dirige e i capi squadra delle squadre coinvolte si sincronizzano tra loro (Scrum of Scrums). Nasce con l'obiettivo e si chiude quando l'obiettivo è raggiunto. Da evitare: gruppo, che resta il nome della vista delle persone.

Sprint: un blocco di fette pronte di una squadra con un obiettivo di sprint. Si chiude quando ogni fetta è fatta o bloccata. Ha quattro eventi registrati: pianificazione (discussione tra agenti con stima), stand-up (a ogni giro, diventa la riga di stato), revisione (i candidati da unire; quelli che cambiano l'interfaccia passano da "Aspetta te") e retrospettiva (lezioni nella memoria della squadra, modifiche al metodo come pratiche reversibili).

Backlog: l'elenco ordinato delle fette, delle issue e dei problemi trovati non ancora in uno sprint. Lo ordina il Coordinatore; la persona può spostare le voci e il suo ordine vince su quello del Coordinatore.

Problema trovato: un problema fuori dal lavoro in corso che Trama riconosce con regole sue, mai con il giudizio del modello: una verifica rossa sul checkout del progetto, una verifica della suite rossa sul candidato e anche sulla sua base, un rilievo non bloccante di un revisore su un file che il candidato non cambia. Il Coordinatore apre una sola issue per problema: prima rilegge le issue aperte e, se una ha lo stesso segno nel testo o lo stesso titolo, collega quella. La issue porta l'etichetta di triage "da valutare" del repository e il riferimento alla prova; il bug triage la smista con `triage` come ogni issue nuova e Trama le applica le etichette dell'esito. Dopo il triage Trama la assegna all'incarico che lavora già sul problema o la mette nel backlog, e la scelta resta in Attività. Il riepilogo cita le issue aperte con il numero. Senza GitHub il problema resta una voce del backlog in Trama. Per aprire le issue serve un mandato concesso; in pausa e nel progetto di esempio non parte niente.

Discussione tra agenti: una conversazione visibile tra agenti per stimare e dividere il lavoro, sciogliere blocchi e dipendenze tra squadre, rivedere un candidato o risolvere un conflitto. Ha un tempo massimo e finisce con una decisione registrata, o con una domanda alla persona se la scelta è di prodotto. Non esistono discussioni private.

## Comunicazione con la persona

Aspetta te: il posto unico e sempre visibile di un progetto con tutto ciò che aspetta la persona: domande, schede del Patto, mandato, candidati che cambiano l'interfaccia, azioni coperte dai divieti fissi. Le voci sono ordinate per quanto lavoro bloccano. In chat resta solo un riferimento alla voce. Mentre una voce aspetta, il Coordinatore lavora sul resto. Il Coordinatore non chiede mai una scelta in testo libero: ogni scelta è una voce di "Aspetta te". Da evitare: notifiche, cose da fare. Oggi le voci sono le domande aperte (anche del chiarimento e degli sviluppatori), la sola richiesta di mandato ancora concedibile (una richiesta superata non è una voce), la proposta del team, i seam e le fette di un piano da confermare, gli obiettivi proposti dal Coordinatore, la proposta di condividere la presenza, i percorsi di Ask Trama da avviare, i candidati di interfaccia da guardare con le schermate e i candidati che il mandato o il progetto lasciano alla persona (quelli con il via libera li unisce Trama), le proposte di modifica della Memoria e le azioni fermate dai divieti fissi. Trama le ricava dai dati del progetto, mai dal modello, e misura quanto bloccano con le fette o gli incarichi fermi per quella voce; a parità viene prima la più vecchia. Una sola funzione decide cosa aspetta la persona: il riepilogo sopra il composer, il contatore nella barra laterale, il prossimo passo e il riepilogo del Coordinatore leggono la stessa lista. Sopra il composer un riepilogo compatto ("2 cose aspettano te") apre l'elenco e con zero voci non compare. Con la risposta la scheda torna intera nella cronologia della chat; rispondere dall'elenco o dalla scheda ha lo stesso effetto.

Riga di stato: la frase sempre visibile che dice cosa fa il Coordinatore ora e cosa farà dopo, per esempio "Sto verificando S2, poi assegno S3". Viene dallo stand-up dell'ultimo giro o dall'ultima mossa. Non è un messaggio della chat. Sta nella barra di stato in fondo alla finestra (ADR 0018).

Riepilogo: il resoconto del Coordinatore a ogni traguardo o su richiesta della persona, in tre parti: cosa ho fatto, cosa faccio, cosa mi serve da te. Cita le issue aperte da solo e le voci di "Aspetta te". Le singole mosse non vanno nel riepilogo né in chat, ma in Attività. Un traguardo è una fetta fatta, un candidato unito o un obiettivo raggiunto; ogni traguardo finisce in un solo riepilogo, anche se arriva insieme ad altri. La persona lo chiede con `/riepilogo`, con una richiesta breve in chat ("A che punto siamo?") o dalla ricerca. Trama lo scrive dai dati del progetto, senza un turno del modello: "Cosa ho fatto" elenca le mosse di Attività dall'ultimo riepilogo e le issue aperte dal Coordinatore con il numero, "Cosa faccio" è la riga di stato, "Cosa mi serve da te" elenca le voci di "Aspetta te" con un rimando a ciascuna, o dice che non serve niente.

Attività: il registro delle singole mosse del Coordinatore e degli agenti di un progetto, consultabile ma non in primo piano. È distinto dalla chat, che resta la conversazione con la persona.

Roadmap del progetto: la vista del progetto in Trama che mette in ordine obiettivi, missioni, sprint, issue e pull request, ricavata dai dati e aggiornata a ogni traguardo. Non è un documento scritto dal modello. Se il repository ha una issue di roadmap, il Coordinatore la aggiorna con gli stessi dati.

## Finestra

Disposizione decisa nell'ADR 0018 (issue #314), sul modello di VS Code. Le fette B01-B09 la portano nell'app.

Barra delle attività: la colonna di icone a sinistra della finestra che sceglie cosa mostrare: Progetti, le cinque viste del progetto (Aspetta te, Lavoro, Squadre, Regole, Memoria) e Impostazioni. Il solo badge è il conteggio di Aspetta te. Da evitare: menu, sidebar per questa colonna.

Barra laterale: il pannello attaccato alla barra delle attività che mostra la vista scelta, una alla volta, con testata, riepilogo, elenco e sezioni chiuse. Si ridimensiona con un separatore e si chiude cliccando di nuovo l'icona della vista.

Vista: ciò che la barra laterale mostra per una voce della barra delle attività. Il nome della vista è uguale alla voce. Le viste del progetto sono cinque: Aspetta te, Lavoro (obiettivi, fette, candidati, branch, pull request e issue), Squadre (squadre, persone della squadra, ruoli condivisi, lavoro automatico), Regole (Mandato con i Moduli, Patto, Standard del codice) e Memoria.

Area dell'editor: la parte centrale della finestra. La prima scheda è sempre la Conversazione con il Coordinatore, che non si chiude.

Scheda dell'editor: un dettaglio aperto accanto alla Conversazione: una persona della squadra, un candidato con l'Esame approfondito, Progetti, Impostazioni. Le schede compaiono solo quando ce n'è più di una. Con la finestra larga il dettaglio si affianca alla Conversazione in un editor diviso. Sostituisce l'ispettore.

Pannello in basso: il pannello sotto l'area dell'editor, attaccato con un separatore orizzontale, che mostra Attività. Si apre dall'icona di Attività nella barra di stato e si chiude.

Barra di stato: la riga in fondo alla finestra con branch, conflitto con il branch principale, riga di stato, obiettivo in primo piano, Attività e Pausa. Dice cosa succede adesso, non chiede decisioni: le decisioni stanno in Aspetta te. Sostituisce la riga del primo piano, la riga di stato sopra la chat e l'avviso di divergenza sopra la chat.

Separatore: la fascia invisibile tra due pannelli attaccati che li ridimensiona, come il sash di VS Code (PR #234): a riposo resta solo il bordo di 1 px del pannello, al passaggio del mouse e durante il trascinamento prende il colore d'accento.
