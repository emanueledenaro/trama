# T09: Revisionare il comportamento su un candidato preciso

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Leggere cosa cambia, eseguire i controlli concordati e approvare esattamente la versione verificata.

## Dipendenze

[T08](./08-sessione-isolata.md)

## Criteri di accettazione

- [ ] Il verificatore raccoglie esiti reali con comando, uscita, log, snapshot del candidato, base, versione delle decisioni e suite.
- [ ] Separare passato, fallito, non eseguito e non più attuale; le dichiarazioni dell’agente non possono creare evidenze o approvazioni.
- [ ] Cambio di candidato, base pertinente, decisione dipendente, suite o nuova esecuzione dei controlli revoca il precedente via libera.
- [ ] Decisioni indipendenti e attività remote estranee non invalidano revisioni non coinvolte.
- [ ] Diff, spiegazione del comportamento ed evidenze sono navigabili; approvazione locale non equivale a merge o pubblicazione.
- [ ] Il candidato viene ricontrollato immediatamente prima di un’operazione che usa la revisione; cambiamenti concorrenti impediscono di agire sulla vecchia approvazione.

## Prova di completamento

Mostrare verifica riuscita, revisione umana e revoca immediata del via libera dopo una modifica pertinente.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
