## NN. Verifiche da fonti primarie

Due domande lasciate aperte dai ticket P02 e P09. Entrambe hanno una risposta, non un'ipotesi.

Le fonti sono locali: nessuna rete. Il repository Synara è letto al commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39`; il pacchetto `@anthropic-ai/claude-agent-sdk` è letto dalla copia installata dentro l'app Synara su questa macchina, versione `0.3.259`, la stessa che Synara fissa in `apps/server/package.json:30`; il pacchetto `@earendil-works/pi-coding-agent` è letto dalla copia installata su questa macchina, versione `0.85.1`, la stessa che Synara fissa in `apps/server/package.json:32-34`.

### Verifica 1: con quale protocollo `@anthropic-ai/claude-agent-sdk` parla con il programma `claude`

**Esito: sì, messaggi JSON delimitati da `\n` su stdin e stdout, con un canale di controllo separato per permessi ed elicitation dentro lo stesso flusso, e i server MCP passati come argomento `--mcp-config` in JSON più un canale `mcp_message` per i server ospitati dall'SDK.**

#### Chi viene avviato

L'SDK risolve il binario nativo `claude` dal pacchetto di piattaforma `@anthropic-ai/claude-agent-sdk-<platform>` (`sdk.mjs`, funzione `initialize`, ramo `if(!YE){let mr=rrt(import.meta.url)...}`; errore "Native CLI binary for ${process.platform}-${process.arch} not found"). L'override è `options.pathToClaudeCodeExecutable`.

Il pacchetto di piattaforma installato è `@anthropic-ai/claude-agent-sdk-darwin-arm64` versione `0.3.259` e contiene l'eseguibile `claude` (`package.json` del pacchetto: `"files":["claude","README.md","LICENSE.md"]`). Il `manifest.json` dell'SDK dichiara `"version": "2.1.259"` e, per `darwin-arm64`, `"binary": "claude"`, `"size": 200225968`.

L'avvio è `child_process.spawn(command, args, { cwd, stdio: ["pipe","pipe","pipe"], signal, env, windowsHide: true })` (`sdk.mjs`, `spawnLocalProcess`). L'opzione `spawnClaudeCodeProcess` sostituisce lo spawn.

#### Framing

Gli argomenti fissi del processo sono (`sdk.mjs`, `initialize`):

```
--output-format stream-json --verbose --input-format stream-json
```

La lettura di stdout (`sdk.mjs`, `readMessages`) usa `readline.createInterface({ input: this.processStdout })` e per ogni riga non vuota fa il parse JSON; una riga non JSON viene registrata con "Non-JSON stdout: ..." e saltata. Quindi il delimitatore è il newline e ogni record è un oggetto JSON.

La scrittura su stdin è `JSON.stringify(message) + "\n"` (`sdk.mjs`: `this.transport.write(me(r)+`\n`)`, dove `me` è `JSON.stringify`). Il trasporto scrive la stringa così com'è (`ProcessTransport.write`).

Conclusione operativa: il protocollo è JSON Lines (NDJSON) bidirezionale su stdio. Non è JSON-RPC: non ci sono campi `jsonrpc`, `id` e `method` nel formato dei messaggi.

#### Forma dei messaggi

Tre tipi di record scorrono in entrambe le direzioni (`sdk.mjs`, `handleControlRequest` e `readMessages`):

- messaggi di sessione e di risultato dell'agente (i record `stream-json` di Claude Code);
- `{ type: "control_request", request_id, request }`;
- `{ type: "control_response", response: { subtype, request_id, response|error } }`;
- `{ type: "control_cancel_request", request_id }`;
- `{ type: "keep_alive" }`;
- `{ type: "transcript_mirror", ... }`.

Gli `request_id` sono generati dall'SDK con `Math.random().toString(36).substring(2,15)` (`sdk.mjs`, `request`).

#### Permessi

Ci sono due meccanismi, entrambi sul canale di controllo.

1. **Callback dell'app.** Se l'app passa `options.canUseTool`, l'SDK aggiunge `--permission-prompt-tool stdio` alla riga di comando (`sdk.mjs`: `if(X){if(S)throw Error("canUseTool callback cannot be used with permissionPromptToolName...");Y.push("--permission-prompt-tool","stdio")}`). Il CLI risponde inviando un `control_request` con `request.subtype === "can_use_tool"`. L'SDK legge `request.tool_name`, `request.input`, `request.permission_suggestions`, `request.blocked_path`, `request.decision_reason`, `request.title`, `request.tool_use_id` e `request.matched_ask_rule` e risponde con un `control_response` di sottotipo `success` o `error` che porta lo stesso `request_id`. Il `tool_use_id` viene restituito nel risultato. L'annullamento arriva come `control_cancel_request` e abortisce l'`AbortController` di quella richiesta.
2. **Modalità di permesso.** `options.permissionMode` diventa l'argomento `--permission-mode`; `options.allowDangerouslySkipPermissions` diventa `--dangerously-skip-permissions`. A runtime l'SDK può cambiarla con il `control_request` `set_permission_mode`.

Altri sottotipi di `control_request` osservati: `initialize`, `hook_callback`, `mcp_message`, `set_permission_mode`, `set_mcp_permission_mode_override`, `mcp_set_servers`, `mcp_status`, `get_context_usage`, e i sottotipi di dialogo utente. L'SDK invia inoltre `control_cancel_request` quando l'`AbortSignal` della richiesta scatta.

#### Server MCP

Tre strade, tutte dentro lo stesso SDK.

- **Server configurati dall'app.** `options.mcpServers` viene serializzato in JSON e passato come `--mcp-config <json>` nella forma `{"mcpServers": {...}}` (`sdk.mjs`: `if(te&&Object.keys(te).length>0)Y.push("--mcp-config",me({mcpServers:te}))`). `options.strictMcpConfig` aggiunge `--strict-mcp-config`.
- **Server ospitati dall'SDK.** Un server con `type: "sdk"` non finisce sulla riga di comando: l'SDK lo dichiara nella `control_request` `initialize` (`sdkMcpServers`, `sdkMcpServerConfigs`) e serve i messaggi con `control_request` di sottotipo `mcp_message`, rispondendo `{ mcp_response: ... }`.
- **Modifica a caldo.** Il `control_request` `mcp_set_servers` sostituisce l'insieme dei server a sessione avviata; `mcp_status` ne restituisce l'elenco.

#### Come Synara lo usa

- Dipendenza fissata a `0.3.259`: `apps/server/src/provider/Layers/ClaudeAdapter.ts:5` (commento) e `apps/server/package.json:30`.
- Caricamento pigro del modulo: `apps/server/src/provider/claudeAgentSdk.ts:8-19`.
- `pathToClaudeCodeExecutable: providerOptions?.binaryPath ?? "claude"`: `ClaudeAdapter.ts:5595`.
- `permissionMode` da `providerOptions?.permissionMode`, con `--dangerously-skip-permissions` quando vale `bypassPermissions`: `ClaudeAdapter.ts:5517-5520`, `5612-5613`.
- `canUseTool` implementato dall'adattatore, con i metodi di evento `canUseTool/decision`, `canUseTool/request`, `canUseTool/ExitPlanMode`, `canUseTool/AskUserQuestion`: `ClaudeAdapter.ts:5326`, `2764`, `5351`, `5431`, `5231`.
- `hooks: { SessionStart, PreToolUse }`: `ClaudeAdapter.ts:5626-5630`.
- `includePartialMessages: true`: `ClaudeAdapter.ts:5622`.
- Server MCP: `mcpServers: buildClaudeMcpServers(gatewaySessionLease!.connection)` (`ClaudeAdapter.ts:5636`), che produce una voce HTTP con header `Authorization` (`apps/server/src/agentGateway/mcpInjection.ts:190-201`). Synara non usa il canale `mcp_message`: gli strumenti host passano da HTTP, come per Codex.
- Fork e ripresa usano le funzioni dell'SDK `forkSession` e le opzioni `resume`/`resumeSessionAt` (`ClaudeAdapter.ts:1937-1938`, `5754-5755`).

#### Limiti della verifica

- Il file `sdk.d.ts` non è presente nella copia installata dentro l'app Synara (l'archivio contiene `sdk.mjs`, `bridge.mjs`, `browser-sdk.js`, `extractFromBunfs.js`, `manifest.json`, `manifest.zst.json`, `package.json`, `LICENSE.md`). Le conclusioni vengono quindi dal codice eseguito `sdk.mjs`, non dalle dichiarazioni di tipo.
- `sdk.mjs` è minificato: i nomi delle funzioni interne non sono quelli del sorgente originale. I nomi citati (`readMessages`, `write`, `initialize`, `spawnLocalProcess`, `request`, `handleControlRequest`, `handleControlCancelRequest`) sono quelli conservati dal bundler come nomi di metodo di classe e sono verificabili nel file.
- Non è stata eseguita nessuna prova di esecuzione: leggere `sdk.mjs` prova come l'SDK costruisce la riga di comando e interpreta il flusso, non che una sessione reale funzioni su questa macchina. Per P02 serve una prova sul componente reale.
- La versione letta è `0.3.259`, allineata a Synara. La versione `latest` sul registro npm al momento della cattura della cache è `0.3.275`: il protocollo qui descritto vale per la versione fissata, non necessariamente per le successive.

### Verifica 2: Pi offre un modo di comunicare con un'altra app fuori dal suo SDK TypeScript?

**Esito: sì. Due modi, entrambi documentati dal pacchetto stesso: la modalità RPC bidirezionale su stdin/stdout e la modalità JSON di sola lettura. Non serve l'SDK TypeScript.**

Fonte: `@earendil-works/pi-coding-agent` `0.85.1` installato su questa macchina, file `README.md` e `docs/rpc.md`, `docs/json.md`. La stessa versione è quella fissata da Synara (`apps/server/package.json:32-34`).

#### Modalità RPC

Avvio: `pi --mode rpc [opzioni]` (`docs/rpc.md`, "Starting RPC Mode").

Descrizione del pacchetto (`README.md:19`): "Pi runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps." Il README aggiunge, alla riga 483: "For non-Node.js integrations, use RPC mode over stdin/stdout".

Protocollo (`docs/rpc.md`, "Protocol Overview" e "Framing"):

- i comandi sono oggetti JSON inviati su stdin, uno per riga;
- le risposte sono oggetti JSON con `type: "response"` che indicano successo o fallimento del comando;
- gli eventi dell'agente sono trasmessi su stdout come righe JSON;
- ogni comando accetta un campo `id` opzionale, e la risposta corrispondente riporta lo stesso `id`;
- il framing è JSONL stretto con `\n` come unico delimitatore di record: si divide solo su `\n`, si accetta un `\r` finale, e non si usano lettori di righe generici. Il documento avverte esplicitamente che il `readline` di Node non è conforme perché divide anche su `U+2028` e `U+2029`, che sono validi dentro le stringhe JSON.

Comandi disponibili (`docs/rpc.md`, indice dei comandi): `prompt`, `steer`, `follow_up`, `abort`, `clear_queue`, `new_session`, `get_state`, `get_messages`, `set_model`, `cycle_model`, `get_available_models`, `set_thinking_level`, `cycle_thinking_level`, `get_available_thinking_levels`, `set_steering_mode`, `set_follow_up_mode`, `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry`, `bash`, `abort_bash`, `get_session_stats`, `export_html`, `switch_session`, `fork`, `clone`, `get_fork_messages`, `get_entries`, `get_tree`, `get_last_assistant_text`, `set_session_name`, `get_commands`.

Eventi trasmessi (`docs/rpc.md`, "Events"): `agent_start`, `agent_end`, `agent_settled`, `turn_start`/`turn_end`, `message_start`/`message_end`, `message_update` (streaming), `bash_execution_update`, `tool_execution_start`/`_update`/`_end`, `queue_update`, `compaction_start`/`compaction_end`, `auto_retry_start`/`auto_retry_end`, `summarization_retry_scheduled`/`_attempt_start`/`_finished`, `extension_error`.

Protocollo UI delle estensioni (`docs/rpc.md`, "Extension UI Protocol"): le richieste dell'estensione escono su stdout (`select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) e le risposte rientrano su stdin. È il ponte che permette a una app esterna di rispondere alle domande delle estensioni, cioè esattamente ciò che in Synara fa il ponte UI di `PiAdapter`.

La modalità RPC accetta le opzioni comuni del CLI, fra cui `--session-dir`, `--no-session`, `--name`, `--provider`, `--model`, `--session <path|id>` e `--fork <path|id>` (`docs/rpc.md` "Starting RPC Mode"; `README.md` tabella "Session Options"). Quindi il cursore di ripresa che in Synara è il percorso del file di sessione resta un ingresso valido anche fuori dall'SDK.

#### Modalità JSON

`pi --mode json "prompt"` stampa tutti gli eventi della sessione come righe JSON su stdout (`docs/json.md`). La prima riga è l'intestazione di sessione `{"type":"session","version":3,"id":...,"cwd":...}`, poi seguono gli eventi. Gli aggiornamenti di streaming sono delta puri: `message_update` omette il campo cumulativo `message` e `assistantMessageEvent.partial`, e il campo `usage` di primo livello è l'ultimo uso cumulativo riportato dal provider. È una modalità a senso unico: serve a leggere, non a pilotare.

#### Ingresso RPC come libreria

Il `package.json` del pacchetto espone anche `"./rpc-entry": { "import": "./dist/bundle/rpc-entry.js" }`, e la cartella `dist/bundle/` contiene `rpc-entry.js`. Quindi lo stesso server RPC può girare dentro un processo Node senza passare dal binario `pi`, ma resta un ingresso Node.

#### Cosa non c'è

- **MCP: no.** `README.md:499` dice "**No MCP.** Build CLI tools with READMEs, or build an extension that adds MCP support." Pi non ha un client MCP nativo. Il percorso per dare a Pi strumenti esterni è una estensione.
- **Strumenti personalizzati fuori dall'SDK: sì, ma via estensione.** Le estensioni registrano strumenti con `pi.registerTool()` (`docs/extensions.md:10`, `:1365`), e `pi.registerTool()` funziona sia al caricamento sia a sessione avviata, con aggiornamento immediato dell'elenco (`docs/extensions.md:1369`). Le estensioni si caricano con `-e`/`--extension <sorgente>` (`README.md`, tabella "Resource Options") e in modalità RPC restano attive: il protocollo UI delle estensioni in `docs/rpc.md` esiste proprio per questo caso. Quindi Trama può avviare `pi --mode rpc -e <estensione>` e farsi registrare dall'estensione gli strumenti che chiamano il gateway di Trama. L'estensione è TypeScript, ma è un file che Pi carica da sé: non è l'SDK incorporato in Trama.

#### Conseguenza per P09

`PiAdapter` di Synara importa l'SDK e gira dentro il processo server, quindi non avvia nessun processo Pi per la conversazione. Trama è una app Swift e non può caricare librerie TypeScript, ma Pi offre un confine di processo documentato e sufficientemente ricco: `--mode rpc` copre prompt, steering, follow-up, abort, modello, livelli di thinking, compattazione, fork, lettura dei turni e statistiche di sessione, e il protocollo UI copre le domande delle estensioni. Il cursore di ripresa resta un percorso di file di sessione. La parte che richiede un'estensione è l'iniezione degli strumenti host, perché Pi non ha MCP nativo.

#### Limiti della verifica

- Letto dalla copia installata su questa macchina alla versione `0.85.1`, che coincide con quella fissata da Synara. Non è stata eseguita nessuna sessione RPC reale: le affermazioni sul protocollo vengono dalla documentazione del pacchetto, non da una prova di esecuzione. P09 deve provare il confine con un processo vero prima di costruirci sopra.
- `docs/rpc.md` è lungo 1618 righe e qui ne sono state lette le sezioni di avvio, framing, comandi, eventi e protocollo UI. I dettagli di ogni singolo comando e dei tipi in coda al documento non sono stati verificati uno per uno.
- Non è stato verificato se la modalità RPC esponga un modo per iniettare strumenti senza estensione. La lettura dice che l'unica via documentata è `pi.registerTool()` da estensione; un'altra via non è stata trovata né dichiarata.
