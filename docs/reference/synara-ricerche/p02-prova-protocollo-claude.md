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

## Deviazioni dall'interfaccia di V08

L'adattatore è conforme al controllo di conformità, che è verde. Le deviazioni sono additive o
motivate dalla realtà del provider:

- `ProviderSessionStartInput` guadagna `toolServerToken: String?`. Codex riceve il token del server
  strumenti dall'ambiente del processo figlio; Claude lo porta in memoria dentro l'argomento
  `--mcp-config`, quindi la credenziale deve arrivare all'adattatore. Il campo è opzionale e il
  comportamento di Codex non cambia.
- `ProviderAccessStatus` guadagna `screenState: String?` con i valori `ready`, `warning` e `error`.
  V08 piega `warning` dentro `unknown`; Synara distingue i tre stati, e il criterio 2 li chiede.
  Il campo è opzionale e i file di stato già scritti restano validi.
- `ProviderCatalogue.claudeAgent.isAvailable` diventa `true`: da P02 esiste un adattatore completo.
- I metodi obbligatori restano il sottoinsieme di V08 più `streamEvents`. Claude implementa anche
  `steerTurn`, `listCommands`, `forkThread`, `respondToRequest` e `respondToUserInput`. Non
  implementa `compactThread` né `rollbackThread`, perché dichiara `supportsThreadCompaction: false`
  e `conversationRollback: .restartSession`, come Synara.
- `--strict-mcp-config` viene passato quando Trama inietta un server. Synara non imposta
  `strictMcpConfig`; Trama isola il server del mandato dagli altri server MCP della macchina, come
  già fa Codex con la sua configurazione ristretta.
- Un input `.skill` diventa un blocco di testo che nomina il file: Claude non ha il riferimento
  `$skill` di Codex, e `supportsSkillMentions` è falso.
- Quando un turno si chiude senza uso dei token, l'adattatore emette un avviso di runtime che lo
  dichiara, invece di lasciare il misuratore su uno zero.

## Stato dei criteri

Verificati con prove reali: 2 e 10 (stato di accesso, falsi negativi compresi), 3 (catalogo runtime),
8 (prova reale con `haiku`), 9 (trasporto nativo), e la prova di completamento a livello di
adattatore (risposta, strumento del mandato chiamato, interruzione, ripresa dopo un riavvio).

Verificati con trasporto simulato: 1 (conformità), 4 (ciclo di vita), 5 (iniezione degli strumenti),
6 (normalizzazione e uso dei token), 7 (casi limite dei test di Synara), 11 (opzioni di Claude),
12 (macchina a stati e compattazione osservata), 13 (uscite 130 e 143).

Parziale: 14. I test di regressione, la revisione Standards e Spec e questa documentazione ci sono;
la prova diretta nell'app è coperta solo dalla riga della schermata dei collegamenti, non da
un'esecuzione grafica. La prova di completamento dentro l'app resta impossibile finché il
Coordinatore non può scegliere Claude: `CoordinatorSession` apre solo Codex e la scelta del provider
è una decisione di prodotto che non esiste ancora.

## La politica dei provider di ADR 0009

Sette criteri aggiunti al ticket dopo l'ADR 0009. Sono implementati in
`Sources/TramaCore/ProviderRuntimePolicy.swift` e nelle strutture che li consumano.

- **Un provider bloccato è uno stato normale.** `ProviderBlockReason` distingue limite di utilizzo
  (con la data di sblocco quando il provider la riporta), autenticazione persa, binario mancante e
  causa non classificata. `ProviderRuntimePolicy.block(for:)` lo legge da uno stato di accesso, e
  l'adattatore di Claude emette l'evento normalizzato `providerBlocked` da un `rate_limit_event` con
  stato diverso da `allowed` e da un `result` in errore che nomina un limite o un accesso perso.
- **Nessun cambio automatico.** `ProviderRuntimeDecision` ha solo `proceed` e `stopAndWarn`. Non
  esiste un ramo che sostituisce il provider. L'incarico passa a `waiting`, resta attivo, e conserva
  worktree, turni e risultati; la ripresa azzera il blocco.
- **La scheda e la striscia di stato.** La scheda `providerBlocked` nella conversazione e
  `ProviderStatusStrip` mostrano motivo e azione proposta, con "Scegli un altro provider" e
  "Riprova". Il cambio resta una decisione della persona.
- **Collegato significa autenticato.** `ProviderOffering.options` elenca ogni provider con il suo
  stato reale; `resolveUnknowns` fa girare il controllo prima di mostrare un provider sconosciuto;
  solo `state == .authenticated` rende il provider selezionabile, e gli altri restano elencati con
  il motivo.
- **Modelli predefiniti.** `ProviderModelDefault.coordinator` prende la voce predefinita del
  catalogo del provider; `specialist` prende il modello più economico della scala di costo nota
  (`haiku` per Claude, `gpt-5.6-luna` per Codex). `ProviderModelPreference` ricorda la scelta della
  persona per provider nel documento. Il Coordinatore di Trama mantiene il modello deciso in #70 per
  Codex: la deviazione è dichiarata nella pull request.
- **Documento del progetto.** Lo schema passa da 6 a 7: l'incarico registra `provider` al momento
  dell'assegnazione, ogni turno registra il provider che lo ha prodotto, e il documento registra
  `lastTurnProvider`. Un test costruisce un documento schema 6 dalla forma reale, toglie i campi
  nuovi, lo ricarica e verifica che ogni dato esistente sopravviva e che il backup resti identico.
- **Riapertura.** `ProviderRuntimePolicy.resumeDecision` riprende con il provider dell'ultimo
  turno; se è bloccato, Trama ferma e avvisa invece di cambiare.
- **Cambio del provider del Coordinatore.** `CoordinatorProviderSwitch.plan` costruisce il passaggio
  con trascrizione, memoria e studio, e segnala che la sessione è nuova. Nell'app il cambio registra
  la scelta, azzera il thread e inietta il passaggio nella sessione successiva. L'apertura di una
  sessione Claude come Coordinatore dentro l'app non esiste ancora: è lo stesso limite di prodotto
  dichiarato sopra.

## Limiti della politica dei provider

- Il runtime del Coordinatore e quello degli specialisti aprono ancora solo Codex. Il provider
  registrato su un incarico o sull'ultimo turno del Coordinatore viene rispettato: se non è Codex,
  Trama si ferma e avvisa invece di aprirne un altro. La selezione nell'app rifiuta un provider che
  il runtime non sa aprire, con il motivo.
- Il passaggio del Coordinatore costruisce e conserva il passaggio di consegne, ma apre la sessione
  solo su Codex. La consegna a un provider diverso resta impossibile finché il runtime non diventa
  agnostico rispetto al provider.
- L'evento di blocco nasce dall'adattatore di Claude ed è provato con trasporto simulato e con il
  processo reale per il limite di utilizzo; il percorso che ferma il Coordinatore dell'app è
  esercitato dai test del modello, non da una sessione Claude dentro l'app.
