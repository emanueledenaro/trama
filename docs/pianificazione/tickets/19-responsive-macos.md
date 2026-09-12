# T19: Adattare il layout alle dimensioni della finestra macOS

Stato: pronto per implementazione. Richiesto dall’utente il 13 settembre 2026.

## Risultato

Ridimensionando Trama, contenuti e azioni restano leggibili e raggiungibili. La finestra deve funzionare anche affiancata a un’altra app, adattando sidebar, dettaglio e inspector allo spazio disponibile.

Base: prima implementazione nativa in #20. Questo lavoro precede la chiusura della verifica completa dell’interfaccia #18.

## Perimetro

- Mappa e albero, ricerca, schede modulo e inspector.
- Richieste, piano, scelta del comportamento, esecuzione e revisione.
- Gruppo, attività GitHub, issue e pubblicazione PR.
- Collegamenti, nuovo progetto, impostazioni, messaggi di errore e finestre modali.

## Criteri di accettazione

- [ ] Provare aree di contenuto di 720×640, 1040×700, 1280×800, 1440×900 e 1920×1080 punti; documentare la nuova dimensione minima supportata.
- [ ] Sidebar e inspector si comprimono o si chiudono in modo prevedibile. I pulsanti per riaprirli restano disponibili e il contesto selezionato viene conservato.
- [ ] La mappa usa colonne adattive. Titoli, percorsi e badge non si sovrappongono; selezione, ricerca e apertura dei file funzionano a ogni dimensione.
- [ ] Le azioni principali restano visibili o raggiungibili con lo scorrimento. Nessun pulsante di conferma o annullamento viene tagliato nelle finestre modali.
- [ ] Gli editor del piano, i dettagli delle issue e gli output si adattano senza ridurre artificialmente la dimensione del testo. Lo scorrimento orizzontale resta confinato ai contenuti che lo richiedono, come codice e diff.
- [ ] Verificare testo lungo, nomi di branch e percorsi lunghi, liste vuote, caricamento, errore e contenuti numerosi.
- [ ] Provare finestra affiancata, schermo intero, apertura e chiusura dell’inspector e passaggio tra le sezioni senza salti della selezione o dimensionamenti forzati.
- [ ] Tutte le azioni restano utilizzabili da tastiera e con etichette accessibili.

## Aree iniziali del codice

`WorkspaceView.swift`, `ProjectMapView.swift`, `DetailViews.swift`, `PlanViews.swift`, `SessionWorkflow.swift`, `TeamView.swift`, `GitHubActivityView.swift`, `IssuesView.swift`.

## Prova di completamento

Mostrare schermate prima e dopo, con gli stessi dati di esempio nelle dimensioni indicate. Percorrere almeno mappa, piano, revisione e una finestra modale nella dimensione minima. Allegare il controllo dei tagli e della navigazione da tastiera; una build riuscita da sola non chiude il ticket.
