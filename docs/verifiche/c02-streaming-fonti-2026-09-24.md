# C02: dialogo in streaming e fonti (2026-09-24)

Controllo dei criteri di #34 sull'app Electron, branch `feature/c02-streaming-sources` sopra `feature/v09-real-run`. Tutte le prove usano il Codex di prova in `app/test-fixtures/fake-codex.mjs`. Nessun modello reale è stato chiamato.

## Cosa c'era già

- Una sola chat per progetto: intestazione con il progetto attivo, selettore del modello nel composer, risposta che cresce con i delta (`project.streaming` in `app/src/main/controller.ts`, riga "Il Coordinatore sta scrivendo" e risposta in `TimelineRows.tsx`).
- Un saluto riceve solo una risposta. Un piano nasce da "Prepara un piano" o dallo strumento `prepare_plan`, che senza mandato viene rifiutato (test in `controller.test.ts`).
- I delta vanno alla richiesta con lo stesso id; la risposta di un obiettivo compare solo nel suo dialogo.
- Errore del turno, account non disponibile e modello fuori catalogo compaiono al posto della risposta, con Riprova. Un modello scelto e poi sparito non viene sostituito.
- Le fonti della risposta aprono il file nell'ispettore; dal file si passa al modulo e alla Mappa. La chat resta dov'era, quindi chiudendo l'ispettore si torna al messaggio. Le viste che erano Modifiche vivono nell'ispettore (ADR 0007).

## Cosa è cambiato

- Cambiare progetto durante una risposta chiude il turno nel progetto giusto: la richiesta diventa interrotta con il motivo "Hai lasciato il progetto mentre il Coordinatore rispondeva." e viene salvata subito. Prima l'errore tardivo finiva in un documento non più salvato e alla riapertura si leggeva "Trama è stato chiuso".
- Un turno interrotto ha una riga visibile al posto della risposta, anche quando Trama è stato chiuso prima di scrivere qualunque evento.
- Il modello non disponibile per l'account mostra anche il messaggio originale del provider.

## Limiti

- Manca la prova con un account ChatGPT reale: l'uso del piano gratuito è esaurito fino al 2026-10-24.
- Il testo già ricevuto di un turno interrotto non viene conservato.
- Con la cronologia non vuota, un Coordinatore non disponibile si vede solo al primo invio.
- La revisione Standards e Spec e la CI sul merge restano da fare.
