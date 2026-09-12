# T02: Riconoscere e collegare Codex di OpenAI

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Dal primo avvio vedere lo stato reale del motore Codex e collegare ChatGPT solo quando necessario.

## Dipendenze

[T01](./01-avvio-nativo.md)

## Criteri di accettazione

- [ ] Versione del componente ufficiale rilevata e protocollo verificato; provider OpenAI esplicito per il processo di Trama.
- [ ] account/read precede il login: un account disponibile viene riconosciuto senza ripetere OAuth o copiare token.
- [ ] Accesso assente, scaduto, annullato, account differente e API key hanno stati distinti; nessun passaggio automatico alla fatturazione API.
- [ ] Motore assente o incompatibile produce un percorso di installazione/riparazione documentato. Il componente viene distribuito solo dopo verifica di licenza e aggiornamenti.
- [ ] Timeout, risposta malformata e uscita del processo terminano la richiesta pendente senza lasciare un falso stato connesso.
- [ ] Una sessione controllata restituisce una risposta minima reale in sola lettura; la pianificazione collegata alle fonti appartiene a T06.

## Prova di completamento

Riconoscere un login esistente, poi provare login annullato e processo interrotto; ottenere una risposta minima reale su un contesto di prova.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
