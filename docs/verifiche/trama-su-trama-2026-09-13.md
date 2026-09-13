# Trama sul proprio repository

Prova del 13 settembre 2026 eseguita direttamente nella build QA nativa, usando il repository locale di `emanueledenaro/trama`.

## Percorso verificato

1. Aperta la cartella dal selettore macOS. La mappa mostra 5 moduli e 68 file: Root, Trama, TramaCore, TramaMonitor e Tests.
2. Chiesta a Codex una spiegazione della distinzione tra chiarimento e piano eseguibile. La risposta appare come Risposta disponibile, con sei riferimenti reali. Aperto dall’interfaccia `Sources/TramaCore/PlanningReply.swift` e verificato il codice mostrato.
3. Nei dati persistiti la spiegazione ha `replyKind=explanation`, senza proposta né sessione di esecuzione.
4. Aperta la sezione Issue: sono visibili i ticket GitHub, compresi responsive #21, allineamento #22 e modelli #23. Selezionato #21 e letto il requisito.
5. Premuto Pianifica con Codex sul ticket #21. Il modello reale ha prodotto un piano di sette passi, dieci fonti, perimetro proposto e scenario da confermare. Il piano è visibile in Modifiche come Da rivedere; i dati persistiti confermano `replyKind=plan`, proposta presente e sessione assente.

## Problemi osservati

- Durante una spiegazione, la build QA mostra ancora “Codex sta preparando il piano”. La correzione del testo è già presente nei sorgenti locali, ma questa build non la include.
- La richiesta importata dal ticket prende come titolo la frase tecnica “Esamina questa issue GitHub come fonte del requisito…”. Nell’elenco manca quindi il titolo riconoscibile del ticket #21. Il requisito completo rimane nel contenuto della richiesta.
- Il corpo delle issue mostra la sintassi Markdown come testo: titoli con `##` e caselle con `[ ]`. La gerarchia visiva richiede una verifica nel lavoro di allineamento #22.

## Limiti della prova

Il percorso apertura, spiegazione, consultazione fonti e issue, generazione del piano è riuscito sul repository reale. Non è stata avviata l’implementazione del piano né pubblicata una PR tramite questa prova. Non dimostra ancora il completamento dei ticket responsive, design o dell’intera beta.

I [dati persistiti delle due richieste](trama-su-trama-2026-09-13.json) conservano gli esiti osservati senza informazioni dell’account.
