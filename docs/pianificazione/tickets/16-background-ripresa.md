# T16: Seguire il progetto a finestra chiusa

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Abilitare il monitoraggio macOS in background e ritrovare uno stato riconciliato dopo chiusura, sospensione o perdita di rete.

## Dipendenze

[T15](./15-reazione-avvisi.md)

## Criteri di accettazione

- [ ] Attivazione, disattivazione e avvio al login sono visibili e passano dai meccanismi Apple appropriati.
- [ ] Chiudere la finestra, terminare l’app, fermare il monitor e sospendere il Mac hanno comportamenti distinti e dichiarati.
- [ ] Il monitor lavora soltanto sui progetti abilitati, con limiti energetici e di uso dei modelli; non riavvia sessioni di modifica del codice.
- [ ] Un solo coordinatore gestisce eventi e coda quando UI e helper sono attivi; i lock e i cursori persistiti evitano doppie analisi.
- [ ] Al risveglio o ritorno in rete riconciliare dal checkpoint agli SHA attuali, aggregare novità e mostrare l’ultimo aggiornamento effettivo.
- [ ] Notifiche negate o suoni disabilitati mantengono tutti gli avvisi consultabili nell’app.

- [ ] Al primo avvio monitor in background e avvio al login sono disattivati; nessun helper viene registrato prima dell’attivazione esplicita. Disattivare annulla la registrazione e la scelta persiste. La sincronizzazione in primo piano del progetto aperto resta distinta.

## Prova di completamento

Chiudere la finestra, pubblicare una modifica di prova, ricevere un avviso; poi provare sospensione e recupero senza eventi duplicati.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
