# Il Coordinatore decide i disaccordi e la chat resta libera mentre il team lavora

Stato: accettata il 29 settembre 2026. Estende il lavoro continuo dell'ADR 0017 e la delega piena dell'ADR 0022. Supera la regola della issue #389 per cui il lavoro fermato più volte dalla revisione aspettava la persona in Aspetta te.

La persona vuole organizzare il lavoro e trovarlo fatto, senza stare davanti al PC: "trama tu organizzi e le cose si fanno in automatico, non devi stare davanti al pc, perché hai un team che sa fare tutto rispettando tutto quello che si dice". Vuole anche parlare con il Coordinatore mentre il team lavora, senza aspettare.

Sul progetto negozio il riallineamento di un branch con main è rimasto fermo per un giorno. Lo sviluppatore aveva risolto il merge. I revisori bloccavano il candidato per i dati aziendali nei documenti. Lo sviluppatore giudicava sbagliati i rilievi e non cambiava niente. Trama rimandava lo stesso lavoro indietro e, dopo tre blocchi di fila, lo lasciava in Aspetta te con "Decidi tu come andare avanti". Nel frattempo il Coordinatore apriva incarichi nuovi uguali ai precedenti.

Nello stesso tempo il turno del Coordinatore restava aperto per tutta la durata del cancello del candidato, cioè le verifiche più tutti i revisori in parallelo, anche per minuti. I messaggi della persona restavano in coda fino alla fine del turno.

Decisione:

- **Il cancello lungo continua in background.** Il turno del Coordinatore aspetta il cancello al massimo 45 secondi (`TRAMA_GATE_TURN_WAIT_MS` per le prove). Poi `review_candidate` risponde che il cancello è al lavoro, il turno si chiude e la persona può scrivere. Quando il cancello finisce, Trama valuta la mossa successiva con l'evento `gateEnded`, come per ogni altro evento del lavoro. Una seconda chiamata sullo stesso candidato aspetta il cancello già al lavoro.
- **Anche le verifiche lunghe continuano in background.** `verify_candidate` e `run_readonly_check` aspettano la verifica quanto il cancello. Una verifica del candidato registra l'evidenza alla fine e Trama valuta la mossa successiva con l'evento `checkEnded`. Una verifica sulla copia del progetto dice l'esito in una riga della chat e al Coordinatore nel turno successivo. Una seconda chiamata sulla stessa verifica aspetta quella già al lavoro. L'unione approvata con la delega piena continua in background come dopo `clear_candidate`.
- **Il messaggio della persona passa davanti a una mossa automatica.** Se il turno in corso è una mossa che Trama ha avviato da sola e la persona scrive nel composer, Trama interrompe la mossa, o non la fa partire se la sta ancora preparando, e il messaggio parte subito. Il lavoro avviato dalla mossa (cancello, verifiche, incarichi) continua in background, e l'esito che il turno aspettava arriva come dopo l'attesa. La mossa messa da parte non è uno Stop della persona e non consuma un tentativo del giro: il giro o il prossimo evento del lavoro la riprendono, e in Attività la sua riga dice che è stata messa da parte per il messaggio della persona. Un turno della persona non si interrompe: un suo altro messaggio, una scelta registrata o un passo restano in coda, e il riepilogo risponde dai registri come prima.
- **Gli eventi del lavoro arrivati in Pausa non si perdono.** Aspettano Riprendi, che li valuta prima del giro.
- **Al secondo blocco di fila decide il Coordinatore.** Il limite scende da tre a due blocchi di fila sullo stesso lavoro. Da lì il lavoro ha il blocco tecnico "disaccordo fra sviluppatore e revisori" e la mossa del Coordinatore "Decidi fra sviluppatore e revisori", che Trama avvia da sola. In Aspetta te non compare niente.
- **Lo strumento `settle_review`.** Il Coordinatore legge i rilievi e la risposta dello sviluppatore e li confronta con il Patto, il mandato, le regole del progetto e i messaggi della persona. Con i revisori, lo sviluppatore riprende nella stessa copia di lavoro con i rilievi come decisione del Coordinatore. Con lo sviluppatore, i rilievi sono superati: il cancello passa, la revisione del candidato lo approva con il motivo, e il Coordinatore lo porta all'unione con `clear_candidate`. In entrambi i casi il conteggio dei blocchi riparte da capo.
- **Le prove di Trama non si superano.** Una verifica rossa, una regressione misurata dal guardiano o un segreto nel diff restano bloccanti: su questi il Coordinatore può solo dare ragione ai rilievi.
- **Come si riconosce un rilievo già superato.** Vale la stessa figura sullo stesso file, anche se il revisore riformula il testo. Per Sicurezza conta anche il titolo: un rilievo nuovo su una falla diversa nello stesso file blocca di nuovo. Se Sicurezza riformula lo stesso rilievo, blocca ancora e il Coordinatore lo supera un'altra volta.
- **Nessun vicolo cieco nel lavoro continuo.** Il giro riprova una mossa che un turno automatico non ha portato a termine, al massimo tre volte di fila, e il nuovo tentativo sa perché il precedente si è fermato; dopo, aspetta un evento nuovo del lavoro. Cambia la regola dell'ADR 0017 per cui dopo un turno automatico fallito decideva la persona. Uno Stop della persona resta suo: il lavoro fermato da lei riparte solo dopo un suo messaggio.
- **Il percorso di Ask Trama parte da solo** con la delega piena o quando il mandato copre i suoi passi, e resta scritto in Attività e tra le scelte da rivedere. Cambia la regola di M07 per cui Trama lo avviava quando la persona confermava.
- **Il mandato e la delega valgono più di una nota di memoria.** Una nota che chiede di aspettare il sì della persona per un passo coperto non ferma il lavoro: il Coordinatore va avanti, corregge la nota e scrive il dubbio.
- **Un candidato verificato va all'unione.** Quando il cancello passa, anche dopo il turno, la mossa del Coordinatore è il via libera (`clear_candidate`) dentro il mandato di integrare.
- **La scelta resta scritta.** Motivo e dubbio vanno in Attività. Con la delega piena la scelta entra anche nel riepilogo, da rivedere.

Alternative scartate:

- **Lasciare la decisione alla persona.** È il comportamento che la persona non vuole: il lavoro si ferma finché lei non torna e la decisione quasi sempre si ricava da quello che ha già detto.
- **Interrompere il turno della persona quando scrive di nuovo.** Nessun provider permette di inserire un messaggio in un turno già avviato. Interrompere perderebbe la risposta che la persona aspetta, a metà di uno strumento. Chiudere il turno mentre il cancello continua libera la chat senza perdere niente.
- **Aspettare la fine della mossa automatica.** Con un provider vero la persona aspettava decine di secondi prima di parlare con il Coordinatore, per una mossa che Trama riprende da sola senza perdere il lavoro già avviato.
- **Togliere il limite dei giri.** Il ciclo fra sviluppatore e revisori non si chiuderebbe mai.

Conseguenze:

- Nuovo evento del lavoro `gateEnded`, nuovo blocco tecnico `reviewLoop`, nuova mossa `settleReview`, nuovo strumento `settle_review`, campo `settled` sul cancello.
- `review_candidate` può rispondere con lo stato `running`: il Coordinatore chiude il turno con una riga per la persona e non richiama lo strumento.
- `verify_candidate` e `run_readonly_check` possono rispondere con lo stato `running`; nuovo evento del lavoro `checkEnded`.
- La voce "Lavoro fermato più volte" non compare più in Aspetta te.
- Nuovo campo `setAside` sulla mossa automatica messa da parte e nuovo esito "Messa da parte" in Attività; il riepilogo non la racconta.
