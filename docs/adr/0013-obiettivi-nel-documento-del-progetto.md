# Gli obiettivi vivono nel documento del progetto e i dialoghi sono viste della sua cronologia

Stato: proposta il 24 settembre 2026 per i ticket UX01-UX07 (#99-#105) della specifica #97. Il prototipo UX00 (#98) è superato dall'ADR 0011: il layout segue l'interfaccia di Synara già in uso. Cambia in parte l'ADR 0007 (una sola conversazione per progetto); gli ADR 0005, 0009 e 0010 restano validi.

La specifica #97 chiede obiettivi con identità stabile, esempi verificabili e un dialogo con il Coordinatore per ciascuno, accanto al dialogo del progetto. Restava da decidere dove conservare gli obiettivi e come separare i dialoghi senza moltiplicare i Coordinatori.

Decisione:

- **Gli obiettivi sono un campo facoltativo del documento del progetto** (`goals`). Un documento scritto prima degli obiettivi si apre invariato: il campo manca e nessuna conversazione storica viene attribuita a un obiettivo indovinato. Lo schema resta alla versione 1, perché l'aggiunta non cambia il significato dei dati esistenti.
- **Le relazioni usano identificativi espliciti.** Richieste, eventi, domande di decisione, incarichi e candidati portano `goalId` quando nascono da un dialogo di obiettivo. L'obiettivo conserva le decisioni collegate (`decisionIds`); incarichi e candidati si trovano dal loro `goalId`. L'interfaccia non crea copie degli oggetti collegati.
- **Il destinatario si fissa all'invio.** La richiesta registra l'obiettivo quando la persona invia il messaggio, anche se resta in coda; gli eventi del turno, le domande poste dal Coordinatore e gli incarichi assegnati lo ereditano dalla richiesta, e l'attività degli specialisti dall'incarico. Cambiare dialogo durante lo streaming non sposta nulla. La risposta a una domanda torna al dialogo in cui era stata posta.
- **Un solo thread del Coordinatore per progetto.** Il dialogo di obiettivo è un filtro della cronologia del progetto, non una sessione separata del provider. Ogni turno di un dialogo di obiettivo riceve titolo, stato, risultato atteso ed esempi dell'obiettivo. Mandato, Patto, memoria e strumenti restano gli stessi, quindi resta un solo Coordinatore responsabile e non esistono aggiornamenti concorrenti delle decisioni comuni.
- **Ogni dialogo ha la propria bozza e la propria selezione del composer** (ADR 0010): il dialogo del progetto le tiene sul documento, ogni obiettivo in `dialog`. Il cambio di provider sposta ancora l'unico Coordinatore, con il passaggio di consegne dell'ADR 0009.
- **Il Coordinatore propone, la persona decide.** `propose_goal` crea un obiettivo proposto che la persona conferma o corregge; `read_goals` legge gli obiettivi. Un progetto senza obiettivi chiude lo studio con la proposta di un primo obiettivo. Nessuno dei due concede un mandato.
- **La motivazione del modello è registrata sull'incarico** (`modelReason` di `assign_task`) come valutazione del Coordinatore. Quando manca, l'interfaccia lo dice invece di dedurla.
- **Le osservazioni degli esempi appartengono al candidato**, con la versione (`snapshotId`) e il testo dell'esempio osservato. Una versione nuova o un testo cambiato le rendono storiche; non sono evidenze delle verifiche e non cambiano il via libera.
- **La panoramica dei progetti è una proiezione.** Il processo principale la calcola dai progetti in memoria e dall'ultimo salvataggio degli altri, senza aprire sessioni AI e senza un secondo archivio di esiti.

Alternative scartate: un thread del provider per ogni obiettivo, che darebbe più Coordinatori capaci di chiedere e registrare decisioni comuni in parallelo e richiederebbe di dimostrare isolamento e coerenza prima dell'uso; un file separato per gli obiettivi, che separerebbe dal documento le relazioni con incarichi e candidati e renderebbe il salvataggio non atomico.

Conseguenze: il contesto del Coordinatore contiene i turni di tutti i dialoghi del progetto. Se in futuro servirà isolare le sessioni per obiettivo, gli eventi hanno già l'identità dell'obiettivo e la scelta si potrà rivedere senza migrare i dati. La regola del modello più economico per gli specialisti dell'ADR 0009 resta il valore predefinito; UX05 aggiunge la motivazione, non ancora una nuova euristica di scelta.
