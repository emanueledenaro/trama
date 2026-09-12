# T15: Aggiornare il piano e avvisare solo quando serve

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Ricevere avvisi pertinenti al proprio lavoro, con spiegazione e azioni concrete, mantenendo la mappa aggiornata.

## Dipendenze

[T13](./13-conflitti-git.md), [T14](./14-intenzione-comportamento.md)

## Criteri di accettazione

- [ ] Separare attività collegata, possibile incoerenza, conflitto riprodotto e decisione richiesta.
- [ ] Mostrare autore quando noto, PR/branch, fonti, conseguenza sul lavoro corrente e azioni Esamina, Rivedi piano, Segna come valutato.
- [ ] Un nuovo evento rivaluta solo piani ed evidenze dipendenti; il lavoro non coinvolto continua.
- [ ] Un conflitto verificato che blocca il patto impedisce la successiva integrazione; la sospensione di un agente segue il perimetro e preserva quanto già scritto.
- [ ] Deduplicare avvisi e risultati, aggregare raffiche di commit, usare cache per SHA e limiti di concorrenza/uso dei modelli.
- [ ] Raggiunti limiti del servizio o budget concordati, continuare raccolta deterministica disponibile e mostrare analisi AI in attesa; nessun fallback a pagamento non autorizzato.
- [ ] La notifica si risolve o si aggiorna quando cambia la situazione; ignorare un avviso non equivale ad approvare il candidato.

## Prova di completamento

Una modifica pertinente produce un solo avviso; dieci aggiornamenti equivalenti non lo duplicano; una correzione lo risolve con nuove evidenze.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
