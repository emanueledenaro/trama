# T07: Prendere una decisione e vedere quali lavori ne dipendono

Stato: parzialmente verificato. Ticket ancora aperto.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Risolvere un caso concreto, registrare la decisione nel Patto Vivo e vedere cosa cambia quando la decisione viene modificata.

## Dipendenze

[T06](./06-richiesta-piano.md)

## Criteri di accettazione

- [ ] La scheda contiene caso concreto, alternative correggibili, risposta libera, esempio accettato e motivazione.
- [x] Ogni variazione incrementa la versione; la cronologia conserva la scelta precedente.
- [ ] I lavori dipendenti diventano da riallineare, quelli indipendenti restano validi.
- [ ] Una simulazione è etichettata come tale; una spiegazione del modello non diventa risultato osservato.
- [x] Il porting Swift del motore viene completato e verificato con test di comportamento, senza assumere validi i risultati salvati del prototipo TypeScript.
- [x] I dati persistiti vengono validati prima del ripristino; dati incompleti non autorizzano candidati.

## Prova di completamento

Passare da richiesta di revisione a rifiuto dell’annullamento e vedere invalidarsi solo il lavoro dipendente.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.

Prove e criteri residui: [riconciliazione della roadmap](../../verifiche/roadmap-a8d9515.md).
