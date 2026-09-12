# T12: Vedere le novità condivise dal gruppo

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Vedere branch, PR, commit, review e check pubblicati su GitHub aggiornarsi nello spazio del progetto.

## Dipendenze

[T03](./03-collegamenti-github.md), [T05](./05-mappa-viva.md)

## Criteri di accettazione

- [ ] Conservare snapshot per repository, branch, SHA, fonte e istante di sincronizzazione; mostrare separatamente checkout locale e stato remoto.
- [ ] Gestire nuovi branch, branch eliminati, PR da fork, cambio della base, force push e paginazione senza riutilizzare analisi obsolete.
- [ ] Polling efficiente con richieste condizionali e rispetto dei limiti; nessun modello chiamato per controlli senza novità.
- [ ] Rete assente, revoca, repository rinominato, risposta incompleta e API limitata conservano l’ultimo stato marcato non aggiornato.
- [ ] Un fetch aggiorna i riferimenti remoti senza checkout, pull, merge o modifica automatica del branch dell’utente.
- [ ] Il lavoro non pubblicato dagli altri è indicato come non osservabile; l’autore di un commit non viene presentato automaticamente come persona attualmente al lavoro.

## Prova di completamento

Da una seconda copia di prova pubblicare una modifica e vederla comparire nella prima senza ricaricare il progetto.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
