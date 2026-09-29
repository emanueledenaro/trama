# Il Coordinatore decide i disaccordi e la chat resta libera mentre il team lavora

Stato: accettata il 29 settembre 2026. Estende il lavoro continuo dell'ADR 0017 e la delega piena dell'ADR 0022. Supera la regola della issue #389 per cui il lavoro fermato più volte dalla revisione aspettava la persona in Aspetta te.

La persona vuole organizzare il lavoro e trovarlo fatto, senza stare davanti al PC: "trama tu organizzi e le cose si fanno in automatico, non devi stare davanti al pc, perché hai un team che sa fare tutto rispettando tutto quello che si dice". Vuole anche parlare con il Coordinatore mentre il team lavora, senza aspettare.

Sul progetto negozio il riallineamento di un branch con main è rimasto fermo per un giorno. Lo sviluppatore aveva risolto il merge. I revisori bloccavano il candidato per i dati aziendali nei documenti. Lo sviluppatore giudicava sbagliati i rilievi e non cambiava niente. Trama rimandava lo stesso lavoro indietro e, dopo tre blocchi di fila, lo lasciava in Aspetta te con "Decidi tu come andare avanti". Nel frattempo il Coordinatore apriva incarichi nuovi uguali ai precedenti.

Nello stesso tempo il turno del Coordinatore restava aperto per tutta la durata del cancello del candidato, cioè le verifiche più tutti i revisori in parallelo, anche per minuti. I messaggi della persona restavano in coda fino alla fine del turno.

Decisione:

- **Il cancello lungo continua in background.** Il turno del Coordinatore aspetta il cancello al massimo 45 secondi (`TRAMA_GATE_TURN_WAIT_MS` per le prove). Poi `review_candidate` risponde che il cancello è al lavoro, il turno si chiude e la persona può scrivere. Quando il cancello finisce, Trama valuta la mossa successiva con l'evento `gateEnded`, come per ogni altro evento del lavoro. Una seconda chiamata sullo stesso candidato aspetta il cancello già al lavoro.
- **Al secondo blocco di fila decide il Coordinatore.** Il limite scende da tre a due blocchi di fila sullo stesso lavoro. Da lì il lavoro ha il blocco tecnico "disaccordo fra sviluppatore e revisori" e la mossa del Coordinatore "Decidi fra sviluppatore e revisori", che Trama avvia da sola. In Aspetta te non compare niente.
- **Lo strumento `settle_review`.** Il Coordinatore legge i rilievi e la risposta dello sviluppatore e li confronta con il Patto, il mandato, le regole del progetto e i messaggi della persona. Con i revisori, lo sviluppatore riprende nella stessa copia di lavoro con i rilievi come decisione del Coordinatore. Con lo sviluppatore, i rilievi sono superati: il cancello passa, la revisione del candidato lo approva con il motivo, e il Coordinatore lo porta all'unione con `clear_candidate`. In entrambi i casi il conteggio dei blocchi riparte da capo.
- **Le prove di Trama non si superano.** Una verifica rossa, una regressione misurata dal guardiano o un segreto nel diff restano bloccanti: su questi il Coordinatore può solo dare ragione ai rilievi.
- **La scelta resta scritta.** Motivo e dubbio vanno in Attività. Con la delega piena la scelta entra anche nel riepilogo, da rivedere.

Alternative scartate:

- **Lasciare la decisione alla persona.** È il comportamento che la persona non vuole: il lavoro si ferma finché lei non torna e la decisione quasi sempre si ricava da quello che ha già detto.
- **Interrompere il turno quando la persona scrive.** Nessun provider permette di inserire un messaggio in un turno già avviato. Interrompere perderebbe il lavoro del turno a metà di uno strumento. Chiudere il turno mentre il cancello continua libera la chat senza perdere niente.
- **Togliere il limite dei giri.** Il ciclo fra sviluppatore e revisori non si chiuderebbe mai.

Conseguenze:

- Nuovo evento del lavoro `gateEnded`, nuovo blocco tecnico `reviewLoop`, nuova mossa `settleReview`, nuovo strumento `settle_review`, campo `settled` sul cancello.
- `review_candidate` può rispondere con lo stato `running`: il Coordinatore chiude il turno con una riga per la persona e non richiama lo strumento.
- La voce "Lavoro fermato più volte" non compare più in Aspetta te.
