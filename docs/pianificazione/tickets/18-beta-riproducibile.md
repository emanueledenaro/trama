# T18: Consegnare una beta locale riproducibile dal codice pubblico

Stato: parzialmente verificato. Ticket ancora aperto.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Permettere a un altro sviluppatore di compilare e provare Trama con istruzioni e limiti verificati.

## Dipendenze

[T17](./17-esperienza-macos.md)

## Criteri di accettazione

- [x] Clone pulito, compilazione Release, test e creazione dell’app riusciti in CI macOS; risorse necessarie incluse.
- [ ] README documenta requisiti verificati di macOS, Swift e Codex, onboarding, supporto dei repository e funzionamento del monitor.
- [ ] Licenze e attribuzioni del progetto, skill AI Hero e componente Codex sono verificate prima di redistribuirli; nessuna dipendenza locale implicita.
- [ ] Evidenze distinguono build locale, test, prova UI, CI remota, firma e notarizzazione. La firma ad hoc locale non viene presentata come distribuzione macOS verificata.
- [ ] La beta pubblica scaricabile resta separata finché firma Developer ID, notarizzazione e installazione su un secondo Mac non sono verificate.

## Prova di completamento

Un altro sviluppatore segue il README da un clone pulito e riproduce mappa, piano reale e scenario di conflitto controllato.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.

Prove e criteri residui: [riconciliazione della roadmap](../../verifiche/roadmap-a8d9515.md).
