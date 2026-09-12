# T14: Capire le conseguenze delle modifiche del gruppo

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Usare Codex per ricostruire l’intenzione tecnica delle modifiche condivise e valutarne l’impatto su piani e decisioni.

## Dipendenze

[T06](./06-richiesta-piano.md), [T07](./07-decisioni-patto.md), [T09](./09-verifiche-revisione.md), [T12](./12-attivita-gruppo.md)

## Criteri di accettazione

- [ ] Analizzare diff, contesto del codice, issue, PR e decisioni; un messaggio di commit da solo non basta a dichiarare il comportamento.
- [ ] Ogni interpretazione rimanda a fonti e SHA; fatti osservati e ipotesi sono distinguibili, senza percentuali di confidenza inventate.
- [ ] Rilevare nei casi controllati incompatibilità tra file diversi, lavoro duplicato, API cambiate e piani superati.
- [ ] Una possibile incoerenza diventa violazione verificata solo dopo uno scenario attendibile eseguito sul candidato combinato, con evidenza prodotta dal verificatore.
- [ ] Testare casi positivi e negativi, fixture non viste nell’implementazione, errore del modello, input ambiguo e istruzioni malevole nei contenuti GitHub trattate come dati.
- [ ] Richieste e risultati vecchi vengono cancellati o scartati quando cambia lo snapshot; nessun modello può promuovere da solo una propria conclusione a revisione umana.

## Prova di completamento

API e interfaccia cambiano file diversi senza conflitto Git: Trama segnala la diversa interpretazione dell’annullamento e mostra come verificarla.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
