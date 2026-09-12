# T13: Ricevere un avviso per un conflitto Git riprodotto

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Confrontare in isolamento il lavoro corrente con cambiamenti del gruppo e segnalare i conflitti verificati.

## Dipendenze

[T08](./08-sessione-isolata.md), [T09](./09-verifiche-revisione.md), [T12](./12-attivita-gruppo.md)

## Criteri di accettazione

- [ ] Il confronto usa base comune e snapshot precisi di entrambi i lavori, compreso il lavoro locale non committato che si dichiara di controllare.
- [ ] La prova di integrazione non modifica checkout, indice, branch, hook o file dell’utente.
- [ ] Toccare lo stesso file senza collisione produce attività collegata, non un falso conflitto.
- [ ] L’avviso collega le parti incompatibili ai rispettivi branch e commit; base mancante o confronto incompleto produce esito non verificabile.
- [ ] Lavoro modificato durante la prova rende obsoleto il risultato e provoca un nuovo confronto limitato alle parti interessate.

- [ ] Ogni evidenza registra snapshot di entrambi i lavori, base comune, procedura o comando ed esito; un cambiamento di uno degli input la rende obsoleta.

## Prova di completamento

Provare due modifiche compatibili nello stesso file e due incompatibili, ottenendo classificazioni diverse e nessun cambiamento nel checkout originale.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
