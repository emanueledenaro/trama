# Selezione dei modelli OpenAI

Verifica del 13 settembre 2026 per il ticket #23.

## Contratto

Codex 0.148 espone il metodo `model/list`. Lo schema generato dal componente dichiara paginazione, voci nascoste, identificativo del modello, nome, descrizione e modello predefinito. Trama chiama questo metodo dopo aver riconosciuto un account ChatGPT e non usa l’endpoint API `/models` né una chiave API.

Il catalogo locale può contenere provider personalizzati. Trama conserva soltanto i modelli OpenAI senza prefisso di provider e continua a impostare `modelProvider` su `openai`. La [documentazione ufficiale OpenAI](https://developers.openai.com/api/docs/models) conferma gli identificativi dei modelli principali, fra cui `gpt-6-astra`, `gpt-5.6-terra` e `gpt-5.6-luna`. La presenza nel catalogo non prova che la versione Codex e l’account possano completare un turno: l’esito effettivo resta quello del componente.

## Prova reale

Il componente ha restituito 17 voci non nascoste. Sette erano modelli OpenAI; le voci con provider personalizzato sono state escluse dal selettore.

Nella build QA, il selettore nativo vicino alla richiesta ha mostrato nome e descrizione. Sono state eseguite tre richieste informative in sola lettura:

- `gpt-5.6-luna`: risposta completata e registrata come `Risposta disponibile`;
- `gpt-5.6-terra`: risposta completata e registrata come `Risposta disponibile`;
- `gpt-6-astra`: Codex ha rifiutato il turno con stato 400 perché il modello richiede una versione più recente. Trama ha mostrato l’errore e ha conservato `gpt-6-astra` nella richiesta, senza sostituirlo.

Il file di stato del progetto conserva `selectedModel` uguale a `gpt-5.6-terra`. Le tre richieste conservano rispettivamente Terra, Astra e Luna; nessuna ha creato una sessione di modifica. Dopo la chiusura e riapertura dell’app, Terra è stato ripristinato prima del completamento del catalogo e poi riconciliato con il nome esposto da Codex.

## Verifiche automatiche

I test coprono paginazione, campi del catalogo, esclusione di un provider esterno, modello esplicito in `thread/start` per pianificazione ed esecuzione e rifiuto di un identificativo con provider prima dell’avvio del processo.

Il modello viene copiato nella richiesta prima dell’attività. Pianificazione ed esecuzione usano quel valore locale; il selettore è disabilitato mentre un’attività è in corso. L’analisi del gruppo include il modello nel proprio contesto e nella chiave che invalida la cache.

## Limiti ancora aperti

La prova non ha eseguito una modifica completa con due modelli diversi. Non è stato simulato un modello salvato che scompare dal catalogo né un accesso ChatGPT scaduto durante il caricamento. Il selettore deve ancora essere verificato con nomi lunghi nella finestra minima e con VoiceOver. Il ticket resta aperto fino a queste prove e alla revisione finale.
