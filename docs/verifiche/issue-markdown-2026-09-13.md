# Issue GitHub leggibili

Verifica del 13 settembre 2026 per i ticket #21 e #22.

## Problema osservato

Nella build precedente il corpo delle issue era un unico `Text`: intestazioni come `## Risultato`, task `- [ ]` e separatori delle tabelle apparivano come caratteri grezzi. Nella finestra stretta il testo restava raggiungibile, ma la gerarchia era difficile da leggere.

## Comportamento implementato

`MarkdownDocument` trasforma localmente il testo in blocchi di presentazione: titoli, paragrafi, elenchi puntati e numerati, task, citazioni, codice, tabelle e separatori. Non interpreta il contenuto come istruzioni e non esegue comandi. La formattazione inline usa il parser Markdown di sistema.

`IssueMarkdownView` usa caratteri e colori di sistema. I titoli espongono il tratto di intestazione; i task comunicano a VoiceOver `Completato` o `Da verificare`; codice e tabelle confinano lo scorrimento orizzontale al proprio contenuto.

## Prove

Due test eseguiti prima e dopo l’implementazione coprono struttura completa, righe di codice, task, citazione e separatore. La prima esecuzione era rossa perché `MarkdownDocument` non esisteva; la seconda è verde.

La build QA è stata riavviata sul repository reale di Trama, nella finestra stretta. La specifica #1 mostra titoli, paragrafi, liste numerate, collegamenti e due tabelle scorrevoli. Il ticket #21 mostra i criteri come task con cerchio e descrizione accessibile. Le azioni Pianifica con Codex e Apri su GitHub restano raggiungibili sotto il documento.

## Limiti

Il parser copre il sottoinsieme usato dalle issue di Trama. Le liste conservano fino a sei livelli di rientro; i ritorni a capo morbidi di uno stesso paragrafo diventano spazi, secondo la semantica Markdown. Altre estensioni non riconosciute rimangono testo. La prova VoiceOver completa e il confronto in tutte le dimensioni restano aperti nei ticket.
