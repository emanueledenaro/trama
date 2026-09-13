# Revisione nella finestra compatta

Prova diretta nella build QA del 13 settembre 2026, dopo l’integrazione della PR #25. Collegata al ticket #21, che rimane aperto.

Nella finestra minima è stato aperto il piano già disponibile del progetto Negozio. L’editor mantiene visibili Annulla e Conferma e avvia sia all’inizio sia dopo lo scorrimento fino al perimetro. Esc chiude l’editor senza avviare una sessione.

È stato poi aperto il candidato Orders già revisionato. Il diff contiene due file del progetto e 44 file del setup AI Hero: il rendering precedente inseriva tutto il testo nella pagina, allontanando le azioni di verifica di migliaia di righe.

La versione aggiornata mostra diff, log di Codex e output dei controlli in un visualizzatore nativo NSTextView, in sola lettura e selezionabile. Ogni pannello occupa 220 punti e dispone di scorrimento verticale e orizzontale. La stringa originale rimane intera; nessuna riga viene filtrata o riscritta. Gli esiti delle verifiche e le condizioni di approvazione non sono modificati.

La prova ha verificato il diff esteso e il log dei test esistenti: entrambi sono leggibili, con scorrimento confinato al pannello e azioni Esegui swift test e Registra revisione raggiungibili. Non sono stati rilanciati i test del candidato o registrate nuove approvazioni durante la prova visiva.

La build dell’app passa. Le revisioni Standards e Spec hanno controllato il renderer e i punti di utilizzo; la verifica diretta ha confermato il dimensionamento del controllo nativo. La navigazione completa con VoiceOver, la matrice delle finestre e le altre modali restano da completare prima di chiudere #21.
