# P02: prova del protocollo di Claude Agent su un processo reale

Ticket P02 (#81). P01 (#80) ha letto il protocollo dal pacchetto `@anthropic-ai/claude-agent-sdk`
spedito, senza eseguire nulla. Questo documento registra cosa Trama ha verificato eseguendo davvero
il programma `claude` su questa macchina. Le prove sono test Swift in
`Tests/TramaCoreTests/ClaudeRealSessionTests.swift`, attivi solo con `TRAMA_CLAUDE_REAL=1`.

## Ambiente della prova

- Binario: `~/.local/bin/claude`, versione `2.1.276 (Claude Code)`. P01 aveva letto il pacchetto
  fissato da Synara, `0.3.259`, che spedisce il binario `2.1.259`: la versione provata qui è più
  recente.
- Account: `seriumbusiness@gmail.com`, piano `Claude Max`, come riportato da `claude auth status` e
  dal controllo di accesso di Trama.
- Modello: `haiku`, il più economico del catalogo runtime, che si risolve in
  `claude-haiku-4-5-20251001`.

## Il protocollo confermato

Trama avvia `claude` con gli argomenti fissi letti in P01 e verificati qui:

```
--output-format stream-json --verbose --input-format stream-json
```

Il programma non riceve `-p`: `--input-format stream-json` implica già la modalità non
interattiva, come fa l'SDK. Il delimitatore è un solo `\n`; ogni record è un oggetto JSON.

Osservati su stdout, in una sessione reale:

- `system` con `subtype: "init"`, che porta `session_id`, `model`, `permissionMode`, `tools`,
  `slash_commands`, `agents`, `mcp_servers`, `skills`, `plugins`, `capabilities` e lo stato della
  modalità veloce (`fast_mode_state`, `fast_mode_disabled_reason`). È la fonte autorevole
  dell'identità della sessione;
- `system` con `subtype: "compact_boundary"`, `"status"`, `"hook_started"`, `"hook_response"`,
  `"thinking_tokens"`;
- `assistant`, con i blocchi `text`, `thinking`, `tool_use` e il campo `usage` della singola
  chiamata API;
- `stream_event` quando è attivo `--include-partial-messages`, con `message_start`,
  `content_block_start`, `content_block_delta` (`text_delta`, `thinking_delta`, `signature_delta`),
  `content_block_stop`, `message_delta`, `message_stop`;
- `user`, che riporta i `tool_result` e i messaggi di sistema come
  `[Request interrupted by user]`;
- `rate_limit_event`;
- `result`, con `subtype`, `is_error`, `usage`, `modelUsage`, `total_cost_usd`, `num_turns` e
  `terminal_reason`.

Sul canale di controllo, dentro lo stesso flusso: `control_request`, `control_response`,
`control_cancel_request` e `keep_alive`. Nessun campo `jsonrpc`.

La richiesta di `initialize` risponde con `commands`, `agents`, `models`, `account`,
`current_permission_mode`, `pid` e lo stato della modalità veloce. `account` porta `email`,
`organization`, `subscriptionType` e `apiProvider`: è la sorgente del controllo di accesso di
Trama e non consuma token, perché precede qualunque chiamata al modello.

## Permessi

Con `--permission-prompt-tool stdio`, un'azione che richiede approvazione arriva come
`control_request` con `request.subtype === "can_use_tool"`, che porta `tool_name`, `display_name`,
`input`, `tool_use_id` e `permission_suggestions`. La risposta è un `control_response` con lo stesso
`request_id` e `response` uguale a `{behavior, updatedInput, toolUseID}` (consentito) oppure
`{behavior: "deny", message, toolUseID}` (rifiutato). Il rifiuto è stato provato con `Write`.

`AskUserQuestion` passa dallo stesso canale, con `requires_user_interaction: true` e
`input.questions`. La risposta consentita porta `updatedInput` uguale a
`{questions, answers, annotations}`, cioè le domande originali più le scelte della persona. La prova
ha risposto "Rosso" alla domanda sul colore e il modello ha riportato la scelta.

Senza `--permission-prompt-tool stdio` il canale risponde comunque a `initialize`, ma un'azione che
richiede approvazione non arriva all'app: il modello riferisce che il permesso è in attesa. Trama
passa quindi sempre l'argomento.

## Strumenti host

Trama inietta il proprio server MCP come argomento:

```
--mcp-config {"mcpServers":{"trama":{"type":"http","url":"http://127.0.0.1:<porta>/mcp","headers":{"Authorization":"Bearer <token>"}}}}
--strict-mcp-config
```

Il nome dello strumento visto dal modello è `mcp__trama__read_study`. La prova reale ha chiamato
quel server, che è il vero `CoordinatorToolServer` di Trama su una porta di loopback, con una
credenziale di sessione vera; il risultato del server è arrivato al modello, che ha risposto
"Il progetto si chiama P02 Real Project", cioè il testo fornito dal server. `--strict-mcp-config`
tiene fuori gli altri server MCP configurati sulla macchina, come già fa Codex con la sua
configurazione ristretta.

## Ripresa e sospensione

`--resume=<uuid>` riapre la conversazione: la prova ha chiesto di ricordare il numero 41, chiuso la
sessione, avviato un secondo processo con il cursore salvato e ricevuto "41". Il cursore di Trama
porta `resume`, `turnCount`, `processedTokenTotal`, `tokenAccountingVersion` e l'osservazione della
cache, con la stessa lettura difensiva di Synara: `resume` solo se è un UUID, la cache solo se il suo
`nativeSessionId` coincide.

Sui segnali: `SIGTERM` fa uscire il programma con codice 143, che Trama legge come sospensione da
riprendere. Nell'esecuzione provata `SIGINT` è stato gestito dal programma stesso, che ha chiuso il
turno con `[Request interrupted by user]` e un `result`; anche 130 è trattato come sospensione.

## Uso dei token

L'uso compare in tre punti: `usage` di ogni messaggio `assistant` (con
`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), il
`usage` e `modelUsage` del messaggio `result`, e la risposta di `get_context_usage` sul canale di
controllo, che porta `totalTokens`, `autoCompactThreshold`, `rawMaxTokens` e
`isAutoCompactEnabled`. La prova reale ha visto il conteggio e il cursore lo ha conservato
(`processedTokenTotal` 40397 e 115110 nelle due esecuzioni).

## Limiti di questa prova

- Il programma provato è `2.1.276`, non il `2.1.259` fissato da Synara. Le forme qui riportate valgono
  per la versione eseguita.
- Non è stato provato il canale `mcp_message` per i server MCP ospitati dall'app: Trama non ne ha.
- Gli hook (`SessionStart`, `PreToolUse`) non sono portati. L'osservazione della cache viene quindi
  dall'uso della richiesta, non dall'hook di avvio sessione.
- La prova non copre il Coordinatore dentro l'app: `CoordinatorSession` di Trama apre ancora solo
  Codex e la scelta del provider non esiste come parte di prodotto. La prova reale è a livello di
  adattatore, con il server strumenti vero di Trama.
