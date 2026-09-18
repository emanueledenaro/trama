## NN. Provider Claude Agent

Ticket: P02.

Claude Agent è l'adattatore che non apre un trasporto suo: chiama `query()` del pacchetto `@anthropic-ai/claude-agent-sdk`, che avvia il programma `claude` e restituisce un iteratore asincrono di `SDKMessage`. La sezione 5 descrive la forma comune dell'adattatore; qui c'è quello che Synara passa all'SDK e quello che ne riceve, riletto al commit `9f91d59`.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Services/ClaudeAdapter.ts` | Tag del servizio, `provider: "claudeAgent"` (`:21-36`) |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts` | Adattatore intero: opzioni di `query()`, permessi, eventi, compattazione (7003 righe) |
| `apps/server/src/provider/claudeAgentSdk.ts` | Caricatore pigro e condiviso dell'SDK (`:18-20`) |
| `apps/server/src/provider/claudeProcessEnv.ts` | Ambiente del sottoprocesso e lettura delle credenziali |
| `apps/server/src/provider/claudeAuthStatus.ts` | Lettura pura di `claude auth status` |
| `apps/server/src/provider/claudeAuthStatusLock.ts` | Mutex FIFO di processo per `claude auth status` |
| `apps/server/src/provider/claudeCredentialKeepalive.ts` | Timer opzionale che tiene viva la credenziale su macOS |
| `apps/server/src/provider/claudeCliVersion.ts` | Versione minima per la modalità Auto |
| `apps/server/src/provider/claudeCacheObservation.ts` | Stima dello stato della cache del prefisso |
| `apps/server/src/provider/claudeTokenUsage.ts`, `claudeResultUsage.ts`, `claudeRequestUsage.ts` | Token, finestre di contesto, differenze cumulative |
| `apps/server/src/provider/claudeTaskTracker.ts`, `claudePluginSkills.ts`, `claudeWorkflowRuntime.ts`, `claudeWorkflowScript.ts` | Task condivisi, radici skill dei plugin, workflow |
| `apps/server/src/provider/Layers/ProviderHealth.ts` | Controllo di accesso Claude (`:997-1191`) |
| `apps/server/src/agentGateway/mcpInjection.ts` | Voce MCP `synara` di tipo http (`:190-200`) |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `claudeCache.ts` | `ClaudeModelOptions`, `ClaudeProviderStartOptions`, `ClaudeCacheObservation` |

### Trasporto

- Non c'è framing scritto da Synara. `createQuery` carica l'SDK e chiama `query({ prompt, options })`, il cui valore di ritorno viene trattato come `ClaudeQueryRuntime` (`provider/Layers/ClaudeAdapter.ts:1918-1928`).
- La superficie usata di quel runtime è esplicita in un'interfaccia locale: iterazione asincrona di `SDKMessage`, più `interrupt`, `stopTask`, `backgroundTasks`, `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `applyFlagSettings`, `getContextUsage`, `supportedCommands`, `supportedModels`, `supportedAgents`, `close` (`ClaudeAdapter.ts:472-489`).
- Il processo lo avvia l'SDK, ma con una funzione di Synara: `spawnClaudeCodeProcess` riceve `bindClaudeProcessOwner(processOwner)`, che chiama `spawnProcess(options.command, options.args, ...)` con `requireExecutable: true`, `cwd`, `env`, `signal` e `stdio: ["pipe", "pipe", "inherit"]` (`ClaudeAdapter.ts:546-554`, `:2029-2035`, `:5632`). Stderr resta ereditato: l'adattatore non lo legge.
- Tenere il riferimento al processo serve alla chiusura provata: `teardownClaudeProcess` aspetta l'uscita dell'albero di processi, e un `createQuery` fallito dopo lo spawn lascia un "orfano" registrato in `failedStartupProcessOwners`, che blocca il tentativo successivo finché non è dimostrata l'uscita (`ClaudeAdapter.ts:2037-2054`, `:5571-5576`, `:5654-5676`).
- In modalità Auto la prima lettura dell'iteratore viene anticipata e messa in gara con la chiusura, perché l'handshake dell'SDK parte solo alla prima lettura (`ClaudeAdapter.ts:491-538`, `:5677-5678`).
- Un fork nativo passa da `forkSession(sessionId, { dir, upToMessageId })` dell'SDK (`ClaudeAdapter.ts:1929-1939`).
- Uscite benigne: se il messaggio d'errore del flusso contiene `exited with code 130` o `143`, oppure `signal sigterm` / `signal sigint`, non è un guasto ma "Claude runtime stopped and will resume on your next message." (`ClaudeAdapter.ts:746-768`). `137` resta un errore.
- `no conversation found with session id` nel flusso invalida la ripresa (`ClaudeAdapter.ts:770-774`).

### Controllo di accesso

`makeCheckClaudeProviderStatus` (`provider/Layers/ProviderHealth.ts:1001-1191`) usa solo la CLI, mai l'SDK per il primo verdetto. Ambiente da `buildClaudeProcessEnv` con `homeDir` (`:1010-1012`). Timeout di 20 s per entrambe le prove (`ProviderHealth.ts:116`, `:1017`, `:1073`). L'eseguibile è `binaryPath` ripulito o `"claude"` (`:1007`) e viene rimandato indietro come `autoRuntimeModeBinaryPath` (`:1184-1187`).

| Passo | Esito | status / authStatus |
| --- | --- | --- |
| `claude --version` assente o non avviabile | "Claude Agent CLI (`claude`) is not installed or not on PATH." oppure "Failed to execute Claude Agent CLI health check: ..." | `error` / `unknown`, `available: false` (`:1020-1033`) |
| `--version` in timeout | "... Timed out while running command." | `error` / `unknown`, `available: false` (`:1035-1045`) |
| `--version` con exit non zero | "Claude Agent CLI is installed but failed to run." più il dettaglio | `error` / `unknown`, `available: false` (`:1047-1060`) |
| `claude auth status` fallito | "Could not verify Claude authentication status: ..." | `warning` / `unknown`, `available: true` (`:1080-1095`) |
| `claude auth status` in timeout | "... Timed out while running command." | `warning` / `unknown`, `available: true` (`:1097-1108`) |

La versione letta da `--version` decide `supportsAutoRuntimeMode`: serve almeno `2.1.111` (`ProviderHealth.ts:1062-1063`; `provider/claudeCliVersion.ts:4-9`).

Lettura dell'output (`provider/claudeAuthStatus.ts:61-116`), su stdout più stderr in minuscolo, in quest'ordine:

1. "unknown command", "unrecognized command", "unexpected argument": `warning` / `unknown` (`:23-30`, `:66-73`).
2. "not logged in", "login required", "authentication required", "run \`claude login\`", "run claude login": `error` / `unauthenticated`, messaggio "Claude is not authenticated. Run `claude auth login` and try again." (`:32-41`, `:75-81`).
3. Stdout che inizia con `{` o `[`: si cerca un booleano di autenticazione con `extractAuthBoolean`. Vero: `ready` / `authenticated`; falso: `error` / `unauthenticated`; JSON illeggibile o senza marcatore: `warning` / `unknown` (`:43-59`, `:84-103`).
4. Exit 0 senza marcatori: `ready` / `authenticated` (`:104-106`). Altrimenti `warning` / `unknown` con il dettaglio (`:108-115`).

Lock FIFO. `claude auth status` può riscattare un refresh token a uso singolo: se due chiamate corrono, la perdente legge `{"loggedIn":false}` su un account valido. `acquireClaudeAuthStatusLock` è una catena di promise senza dipendenze: ogni chiamante aspetta la coda precedente e la coda avanza subito, così chi si registra dopo attende anche il rilascio; il rilascio doppio è innocuo (`provider/claudeAuthStatusLock.ts:21-47`). La prova di salute lo prende con `Effect.acquireUseRelease` (`ProviderHealth.ts:1069-1076`), e lo condivide con il keepalive di macOS.

Falso negativo strutturato: `loggedIn:false` con exit 0, senza testo di login richiesto, è sospetto (`claudeAuthStatus.ts:118-128`). Se non c'è un file di credenziali utilizzabile, la prova si ripete una volta dopo 1 s (`ProviderHealth.ts:999`, `:1119-1133`). Se invece il file c'è, si spende una prova SDK: `query()` con un prompt che non produce mai nulla, `persistSession: false`, `abortController`, `settingSources: ["user","project","local"]`, `allowedTools: []`, `stderr: () => {}`, si legge `initializationResult().account?.subscriptionType` e si interrompe subito; timeout 8 s (`ProviderHealth.ts:458-499`). Solo se quella prova risponde lo stato diventa `ready` / `authenticated` (`:1138-1149`).

Etichette: `apiKey` dà "Claude API Key"; altrimenti il tipo di abbonamento dà "Claude Max/Enterprise/Team/Pro/Free Subscription", con ripiego a parole in maiuscolo iniziale (`claudeAuthStatus.ts:130-174`).

Keepalive: solo su macOS e solo con `SYNARA_CLAUDE_KEEPALIVE` attivo; intervallo di 30 minuti da `SYNARA_CLAUDE_KEEPALIVE_MINUTES`, limitato al massimo timer di Node; timeout del comando 20 s (`provider/claudeCredentialKeepalive.ts:21-22`, `:32-34`, `:48-63`, `:83`).

Ambiente del processo (`provider/claudeProcessEnv.ts:126-148`): si copia l'ambiente, si forza `HOME` se è dato, si cerca una credenziale OAuth utilizzabile in `$CLAUDE_CONFIG_DIR/.credentials.json` e poi `~/.claude/.credentials.json` (`:61-74`). Una credenziale è utilizzabile se ha `accessToken` o `refreshToken` e non è scaduta senza refresh (`:76-95`). Se esiste e non ci sono backend espliciti (`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`), si cancellano `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` e `CLAUDE_CODE_OAUTH_TOKEN` dall'ambiente del figlio, perché Claude dà la precedenza alle credenziali dirette (`:11-22`, `:139-148`).

### Catalogo modelli

- Fonte a runtime: `queryRuntime.supportedModels()` dell'SDK, mappato da `mapClaudeModelInfo`: `slug` da `value`, `resolvedModel` se c'è, `name` da `displayName`, descrittori di opzione dalle capacità statiche del modello risolto, `supportsAutoMode` solo se è un booleano (`ClaudeAdapter.ts:926-940`).
- Ordine di ricerca in `listModels`: cache di modulo, poi una sessione viva e non fermata, poi un processo `claude` temporaneo (`ClaudeAdapter.ts:6868-6927`).
- Cache: una sola variabile `cachedModels` per tutto il layer, senza scadenza; una volta piena si serve con `cached: true` (`ClaudeAdapter.ts:1948`, `:6870-6871`). La prima sessione non-Auto la riempie in sottofondo e ignora i fallimenti (`:5691-5725`).
- Processo di scoperta: `createQuery` con prompt che non si risolve mai, `cwd`, `pathToClaudeCodeExecutable`, `settingSources`, `permissionMode: "plan"`, `persistSession: false`, `env`, `spawnClaudeCodeProcess`; l'iteratore viene consumato a vuoto per completare l'handshake, poi `close()` e smontaggio provato (`ClaudeAdapter.ts:6691-6731`, `:6742-6751`). Le scoperte concorrenti condividono la stessa promise `pendingModelDiscovery` (`:6894-6901`).
- Voci malformate: l'adattatore non filtra nulla di suo, prende `value` e `displayName` così come arrivano (`ClaudeAdapter.ts:926-940`). Il filtro sullo schema dei descrittori sta a valle, in `ProviderDiscoveryService`.
- Catalogo statico di ripiego: dieci modelli da `claude-fable-5-1` a `claude-haiku-4-5` (`packages/contracts/src/model.ts:622-691`); predefinito `claude-sonnet-5` (`model.ts:1140`); alias come `opus` verso `claude-opus-5` o `claude-opus-4-8-20260528` verso `claude-opus-4-8` (`model.ts:1181-1200`).
- Skill: `listSkills` risponde sempre lista vuota con `source: "unsupported"` (`ClaudeAdapter.ts:6814-6821`). Le radici skill dei plugin Claude si leggono altrove, da `~/.claude/plugins/installed_plugins.json` con i percorsi vincolati dentro la cache dei plugin (`provider/claudePluginSkills.ts:142-155`).

### Opzioni

```ts
// packages/contracts/src/model.ts:106-114
ClaudeModelOptions = { thinking?: boolean; effort?: ClaudeCodeEffort; fastMode?: boolean;
                       autoCompactWindow?: string; contextWindow?: string /* legacy */ }
// packages/contracts/src/orchestration.ts:194-198
ClaudeProviderStartOptions = { binaryPath?: string; permissionMode?: string; maxThinkingTokens?: number }
```

Sforzo chiuso: `low`, `medium`, `high`, `xhigh`, `max`, più `ultrathink` (parola nel prompt) e `ultracode` (`model.ts:8-19`).

Oggetto passato a `query()` (`ClaudeAdapter.ts:5590-5639`):

| Campo | Valore |
| --- | --- |
| `cwd` | `input.cwd` se c'è (`:5591`) |
| `model` | id API risolto dalla selezione (`:5594`) |
| `pathToClaudeCodeExecutable` | `providerOptions.binaryPath` o `"claude"` (`:5595`) |
| `settingSources` | `["user", "project", "local"]` (`:5596`; `:1218-1222`) |
| `systemPrompt` | `{ type: "preset", preset: "claude_code", append, excludeDynamicSections: true, snapshot? }` (`:5597-5607`) |
| `agents` | subagent condivisi, solo se ce n'è almeno uno (`:5608`) |
| `effort` | `"max"` e basta: gli altri livelli viaggiano in `settings` (`:5609-5611`) |
| `permissionMode` | vedi sotto (`:5612`) |
| `allowDangerouslySkipPermissions` | `true` solo con `bypassPermissions` (`:5613-5615`) |
| `maxThinkingTokens` | da `providerOptions`, se definito (`:5616-5618`) |
| `settings` | `autoCompactEnabled: true`, più `autoCompactWindow`, `alwaysThinkingEnabled`, `effortLevel`, `fastMode`, `ultracode` quando richiesti (`:5522-5538`) |
| `resume` | id nativo dal cursore, se c'è (`:5620`) |
| `sessionId` | UUID generato dall'app, solo per sessioni nuove (`:5621`, `:5093-5095`) |
| `includePartialMessages` | `true` (`:5622`) |
| `forwardSubagentText` | `true` (`:5623-5625`) |
| `hooks` | `SessionStart: [sessionStartHook]`, `PreToolUse: [subagentSteerHook]` (`:5626-5629`) |
| `canUseTool` | callback di permesso (`:5630`) |
| `env` | `buildClaudeProcessEnv({ homeDir: serverConfig.homeDir })` (`:5631`, `:2025-2027`) |
| `spawnClaudeCodeProcess` | spawn di Synara legato al proprietario del processo (`:5632`) |
| `additionalDirectories` | `[input.cwd]` se c'è (`:5633`) |
| `mcpServers` | solo con credenziali del gateway (`:5634-5638`) |

Modalità di permesso (`ClaudeAdapter.ts:5517-5521`): `runtimeMode: "auto"` dà `"auto"`; altrimenti vale `providerOptions.permissionMode` se è uno fra `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk` (`:913-923`); se non c'è e la modalità è `full-access`, `"bypassPermissions"`; altrimenti niente, e l'SDK usa il suo `default`.

`auto` costa una verifica prima dello spawn: `claude --version` con `execFile`, timeout 10 s, buffer 64 KiB (`ClaudeAdapter.ts:556-582`). Sotto `2.1.111` la sessione non parte; da `2.1.267` in su si aggiunge `snapshot: true` al prompt di sistema (`:5542-5570`).

`canUseTool` (`ClaudeAdapter.ts:5326-5490`), nell'ordine:

1. Contesto mancante: `deny` con "Claude session context is unavailable." (`:5330-5335`).
2. `AskUserQuestion`: diventa un evento `user-input.requested`, sempre, anche in `full-access` (`:5340-5342`).
3. `ExitPlanMode`: il piano si cattura come `proposed-plan`, poi `deny` con un messaggio che dice all'agente di fermarsi e aspettare (`:5344-5364`).
4. `full-access`, oppure "consenti sempre" già concesso in sessione: `allow` con l'input invariato (`:5366-5372`).
5. Altrimenti si apre una `request.opened` con `requestType`, `detail`, `toolName`, l'input, `sessionApprovalAvailable` e `toolUseId`, e si aspetta la decisione (`:5379-5463`).
6. `accept` o `acceptForSession` danno `allow`; `acceptForSession` fuori da Auto alza il flag di sessione, e se l'SDK ha mandato `suggestions` queste tornano indietro come `updatedPermissions` (`:5465-5479`). `cancel` dà "User cancelled tool execution.", il resto "User declined tool execution." (`:5482-5488`).

In Auto l'SDK chiama `canUseTool` solo per l'esito interattivo del classificatore; le chiamate permesse non passano di qui e quelle negate arrivano come messaggi `permission_denied` (`:5374-5378`).

A ogni turno si rimanda `setPermissionMode`, con una sola eccezione provabile: il primo turno di una sessione il cui modo desiderato coincide con quello di spawn (`ClaudeAdapter.ts:5979-6012`). `plan` come `interactionMode` forza `"plan"`, il ritorno riporta `basePermissionMode`.

Cambi a caldo, senza riavvio: `setModel` per il modello, `applyFlagSettings` per `autoCompactWindow`, `alwaysThinkingEnabled`, `effortLevel`, `ultracode`, `fastMode` (`ClaudeAdapter.ts:6105-6214`). `max` non ha equivalente nelle impostazioni, quindi le transizioni che lo coinvolgono riavviano a monte (`:6174-6177`).

### Capacità dichiarate

Oggetto `capabilities` (`ClaudeAdapter.ts:6959-6970`):

| Campo | Valore |
| --- | --- |
| `sessionModelSwitch` | `"in-session"` |
| `conversationRollback` | `"restart-session"` |
| `supportsSkillMentions` | `false` |
| `supportsSkillDiscovery` | `false` |
| `supportsNativeSlashCommandDiscovery` | `true` |
| `supportsPluginMentions` | `false` |
| `supportsPluginDiscovery` | `false` |
| `supportsRuntimeModelList` | `true` |
| `supportsTurnSteering` | `true` |
| `supportsLiveTurnDiffPatch` | `false` |

Le capacità del composer ripetono gli stessi valori e aggiungono `supportsThreadCompaction: false` e `supportsThreadImport: true` (`ClaudeAdapter.ts:6852-6862`). Oltre al minimo, il servizio dichiara obbligatori `steerTurn`, `stopTask`, `backgroundTask`, `steerSubagent` (`provider/Services/ClaudeAdapter.ts:21-29`) ed espone anche `getClaudeCacheObservation`, `startClaudeCompaction`, `forkThread`, `rollbackThread`, `listModels`, `listCommands`, `listAgents`, `listSkills` (`ClaudeAdapter.ts:6971-6995`).

### Ciclo di vita e cursore di ripresa

- Identità nativa: se il cursore porta un id, si passa come `resume`; se non c'è, l'app genera un UUID e lo passa come `sessionId`, così la sessione ha un nome prima ancora del primo messaggio dell'SDK (`ClaudeAdapter.ts:5090-5095`, `:5620-5621`).
- Forma del cursore (`ClaudeAdapter.ts:2190-2202`, `:5750-5765`):

```ts
// ClaudeAdapter.ts:2190-2202
{ claudeCache?: ClaudeCacheObservation; threadId: ThreadId; resume?: string;
  resumeSessionAt?: string; turnCount: number; trackedTasks?: ClaudeTrackedTask[];
  processedTokenTotal?: number; tokenAccountingVersion?: 1 }
```

- Lettura difensiva (`ClaudeAdapter.ts:942-997`): `threadId` scartato se è sintetico; `resume` accettato da `resume` o dal vecchio `sessionId` e solo se è un UUID; `turnCount` solo se intero non negativo; `processedTokenTotal` solo se intero sicuro non negativo e con `tokenAccountingVersion === 1`; `claudeCache` tenuto solo se passa lo schema e il suo `nativeSessionId` coincide con `resume`.
- Prima di ogni avvio: si smonta l'eventuale orfano dello start precedente, poi si ferma la sessione esistente per lo stesso thread, perché una sostituzione fallita deve essere una sessione ferma, mai due runtime (`ClaudeAdapter.ts:5571-5582`).
- Interruzione: `query.interrupt()` con tetto di 10 s, perché l'interrupt dell'SDK si risolve solo quando la CLI conferma (`ClaudeAdapter.ts:1224-1226`, `:6443-6456`).
- Rollback: `rollbackThread` non tocca i turni e fallisce sempre con `ProviderAdapterValidationError` e il messaggio "Claude rollback requires a session restart for thread '<id>'."; il riavvio lo fa `ProviderService`, che possiede anche il bootstrap della trascrizione (`ClaudeAdapter.ts:6524-6532`).
- Fork nativo (`ClaudeAdapter.ts:6535-6588`): rifiutato se la sorgente ha un turno in volo, perché `lastAssistantUuid` può puntare a un `tool_use` senza risultato; rifiutato se non c'è id nativo; altrimenti `forkSession` con `dir` e `upToMessageId`. Il cursore del fork non porta `resumeSessionAt` né i task, tiene il maggiore fra i due `turnCount` e riazzera `processedTokenTotal`.
- Compattazione nativa (`ClaudeAdapter.ts:6014-6073`): si riconosce `/compact` con `^\/compact(?:\s|$)` (`:1290-1292`); gli allegati la fanno fallire; si controlla con `supportedCommands()` entro 1 s che esista il comando `compact`; si rifiuta se la sessione è cambiata nel frattempo, se c'è lavoro condiviso attivo o se manca l'identità nativa. Il turno di compattazione porta `explicitCompaction = { nativeSessionId, boundaryObserved: false }` (`:6226-6233`), il messaggio `compact_boundary` lo conferma (`:4431-4437`) e l'esito si dichiara compattato solo se il confine è stato visto e il `session_id` del risultato combacia (`:3193-3198`).
- Osservazione della cache (`provider/claudeCacheObservation.ts`): l'hook `SessionStart` produce `nativeSessionId`, `model`, `contextTokens`, `lastResponseAt` da `seconds_since_last_response`, `state` da `prompt_cache_likely_expired` e `estimatedCacheWriteUsd` (`:46-73`). L'uso di richiesta produce `contextTokens` come somma di input, letture, scritture e output solo se tutti e quattro sono noti, `ttlSeconds` 300 con `ephemeral_5m_input_tokens`, 3600 con `ephemeral_1h`, e `state: "likely-warm"` solo se c'è davvero del cache (`:35-44`, `:75-121`). Un cambio di modello marca il prefisso `likely-expired` e butta la stima di prezzo (`:123-131`). L'hook può arrivare prima che il contesto esista: l'osservazione resta nella chiusura dello start (`ClaudeAdapter.ts:5117-5151`).
- `getClaudeCacheObservation` chiede `getContextUsage({ detail: "summary" })`, con tetto di 1 s; se non risponde, il controllo si spegne per quella sessione e non blocca i turni futuri (`ClaudeAdapter.ts:1223`, `:2538-2561`, `:5941-5977`).

### Iniezione degli strumenti host

- Voce MCP passata a `query()` (`agentGateway/mcpInjection.ts:190-200`):

```ts
// mcpInjection.ts:190-200
{ synara: { type: "http", url: connection.url, headers: { Authorization: `Bearer ${bearerToken}` } } }
```

Il nome del server è la costante `SYNARA_MCP_SERVER_NAME = "synara"` e l'header è `Bearer <token>` (`mcpInjection.ts:24`, `:29-31`). A differenza di Codex, qui il token sta in memoria nell'oggetto opzioni, non in un file né in una variabile d'ambiente.

- La lease per thread si prende prima di `createQuery` e si rilascia se lo start fallisce, se il flusso si interrompe o quando la sessione si ferma (`ClaudeAdapter.ts:5585-5589`, `:5673`, `:4952-4953`, `:5922`). Un'interruzione di turno passa da `withAgentGatewayTurnCancellation` (`:6423-6444`), e la fine del turno da `cancelAgentGatewayTurn` (`:3078`).
- Il prompt di sistema resta il preset `claude_code` con un'aggiunta: Synara si presenta come app ospite, chiede di trattare la cartella corrente come spazio di lavoro, spiega come scegliere modello e sforzo dei subagent, e include la politica dell'harness resa da `renderSynaraHarnessPolicy({ gatewayControlAvailable, automationAuthoring: "tool-descriptions" })` (`ClaudeAdapter.ts:1227-1239`). Senza credenziali del gateway il testo dice apertamente che il controllo MCP non c'è.
- Subagent registrati come `agents`: gli alias condivisi di tipo `claude-subagent`, più quattro varianti `worker-low`, `worker-medium`, `worker-high`, `worker-xhigh` che fissano solo `effort` e lasciano il modello ereditato, perché lo strumento Agent ha un parametro `model` ma non uno per lo sforzo (`ClaudeAdapter.ts:1241-1288`).
- `excludeDynamicSections: true` sposta cartella di lavoro e percorso della memoria nel primo messaggio utente, per tenere statico il prefisso del prompt di sistema e quindi riusabile in cache (`ClaudeAdapter.ts:5601-5605`).

### Eventi d'uso

- Un solo tipo canonico, `thread.token-usage.updated`, emesso dal progresso dei task, dal risultato del turno, dall'uso per richiesta e dall'osservazione della cache (`ClaudeAdapter.ts:2574`, `:3029`, `:3132`, `:3999`, `:4096`).
- Normalizzazione (`provider/claudeTokenUsage.ts:90-128`): i token di prompt sono `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; il totale viene da `total_tokens` o dalla somma; zero o assente scarta lo snapshot; `usedTokens` si taglia alla finestra e `totalProcessedTokens` compare solo se la supera.
- Risposta viva dell'SDK (`snapshotFromClaudeContextUsage`, `:208-250`): il massimo effettivo è `autoCompactThreshold`, poi `maxTokens`, poi `rawMaxTokens`; `compactsAutomatically` viene da `isAutoCompactEnabled`.
- Finestre: `200k` e `1m` sono le uniche opzioni riconosciute (`:18-27`); `claude-opus-4-6` e `claude-sonnet-4-6` senza suffisso valgono 200k perché il contesto esteso è a scelta (`:159-175`); una finestra riportata più piccola di quella nota non declassa mai la capacità del modello (`:195-206`). Il budget effettivo è il minimo fra soglia di auto-compattazione e finestra (`:78-88`).
- Solo un `autoCompactWindow` scelto in modo esplicito e diverso dal predefinito viene fissato; altrimenti la risoluzione resta a Claude Code (`:177-193`).
- Avvisi (`:252-303`): "uncached-ingestion" oltre 50.000 token di input freschi in una richiesta, "near-window" oltre l'80% del budget, "large-prompt" oltre 200.000 token; ciascuno una volta sola per sessione.
- Costo e uso per modello: `claudeTurnResultUsage` sottrae la linea di base del risultato precedente da `modelUsage` e `total_cost_usd`, perché l'SDK riporta valori cumulativi di processo (`provider/claudeResultUsage.ts:8-38`).
- Uso per richiesta: `ClaudeRequestUsage` conta per `message.id`, ignora l'ultimo turno già chiuso e restituisce solo l'incremento (`provider/claudeRequestUsage.ts:3-25`).
- Dopo una chiamata di compattazione la contabilità entra in `skip-compaction-call` e poi `awaiting-fresh-assistant`, finché non arriva una risposta nuova (`ClaudeAdapter.ts:326`, `:3964-3999`, `:4437`).

### Casi limite dai test

Opzioni e modalità:
- Modalità bypass da `full-access` (`provider/Layers/ClaudeAdapter.test.ts:734`, "derives bypass permission mode from full-access runtime policy").
- Modalità auto senza scavalcare le protezioni (`:796`); Auto rifiutata su binario non supportato prima dello start (`:815`).
- Fonti di impostazioni caricate per le sessioni SDK (`:856`); modalità esplicita che vince sui predefiniti (`:893`).
- Sforzi inoltrati (`:917`), budget 1m e contesto esteso (`:942`), `xhigh` per Opus 4.7 (`:969`), Sonnet 5 senza fissare la finestra nativa (`:995`), tutti gli sforzi API di Sonnet 5 (`:1023`), `ultracode` come `xhigh` più impostazione (`:1056`), `max` per Sonnet 4.6 (`:1087`).
- Sforzo ignorato per Haiku 4.5 (`:1112`); toggle del pensiero solo per Haiku (`:1137`, `:1165`); `fastMode` solo sui modelli che lo reggono (`:1192`, `:1220`); `ultrathink` come parola del prompt e non come sforzo di sessione (`:1247`).
- `setPermissionMode` saltato solo al primo turno (`:1287`), rimandato al secondo (`:1313`), su ogni turno di una sequenza plan/default (`:1446`), saltato dopo una ripresa (`:1495`).

Permessi e domande:
- `ExitPlanMode` catturato e negato (`:10465`); piani estratti anche dagli snapshot dell'assistente (`:10532`, `:10603`).
- `AskUserQuestion` con ciclo richiesta e risposta (`:10667`), risposte multiple unite con virgola (`:10792`), instradata anche in `full-access` (`:10887`), negata se già abortita (`:10958`, `:11012`), chiusa una volta sola prima dello stato terminale (`:11081`).
- Una sola di due risposte concorrenti viene accettata, sia per l'input utente (`:11302`) sia per l'approvazione (`:11370`); Auto resta con revisore anche dopo un "consenti per la sessione" (`:7412`).

Processo e ripresa:
- SIGTERM esterno trattato come sospensione benigna (`:4991`); conversazione ripresa e non trovata invalidata (`:5055`).
- Riavvio dopo `authentication_failed` e `account_on_hold` (`:4716`).
- Possesso del processo tenuto finché l'uscita dell'albero non è provata (`:5112`), ritentato se la prova fallisce (`:5170`), nessun runtime lasciato se lo spawn sostitutivo fallisce (`:8927`), riprova bloccata se `createQuery` aveva già generato il processo (`:5285`), riscoperta dei comandi bloccata sullo stesso motivo (`:5362`).
- Lease del gateway rilasciata una volta sola fra vecchia e sostituzione fallita (`:8963`) e all'interruzione spontanea del flusso (`:8999`).
- Id di sessione generato dall'app per le sessioni nuove (`:7852`); id di ripresa passati senza fissare un checkpoint vecchio (`:7726`); id durevoli conservati attraverso gli hook (`:7761`); nessun id di thread inventato prima del primo `session_id` (`:7334`).
- Rollback dichiarato come riavvio invece di modificare i turni locali (`:7884`).

Fork e compattazione:
- Fork nativo dal cursore persistito, senza i pin di uuid della sorgente (`:11543`); rifiutato con un turno in volo (`:11592`); `turnCount` maggiore conservato (`:11644`); nessun cursore nativo (`:11688`); fallimento mappato a errore di richiesta (`:11722`).
- Scoperta fallita provata prima della spedizione (`:11756`); nessun prompt in coda se `compact` non è tra i comandi (`:12001`); scoperta limitata nel tempo senza accodare prompt (`:12018`).
- Testo ordinario non scambiato per compattazione: `/compactly`, `Explain /compact` (`:11920`).
- Esito terminale verificato su quattro scenari: `no-boundary`, `foreign-boundary`, `failed`, `interrupted` (`:11945`).
- Compattazione bloccata con approvazione o domanda in sospeso (`:12112`) e con lavoro condiviso attivo, turno, task o workflow (`:12168`); allegati rifiutati prima di creare il turno (`:12076`); modello e modalità preservati mentre si compatta (`:12037`).

Cache e token:
- Output aggiunto al contesto solo quando il riepilogo e l'ultima richiesta corrispondono (`provider/claudeCacheObservation.test.ts:13`); TTL più corto per durate miste (`:80`); TTL non riusato attraverso un cambio di sessione o modello (`:89`); evidenza del modello vecchio invalida finché una richiesta non la rinfresca (`:143`).
- Evidenza di cache persistita attraverso un riavvio per hook precoce, tardivo e cambio di modello (`provider/Layers/ClaudeAdapter.test.ts:12319`); hook precoce bufferizzato senza rimpiazzare `PreToolUse` (`:12407`); hook tardivo di un processo ritirato ignorato (`:12579`).
- Token: blocchi ripetuti contati una volta (`:9232`), contabilità conservata attraverso interruzione, consegna tardiva, pulizia e ripresa (`:9421`), uso di compattazione invalidato fino alla risposta seguente (`:9552`), contabilità cumulativa ripresa dal cursore (`:9664`), accounting parziale di un cursore vecchio non promosso (`:9722`).
- Quattro confini di accounting del risultato: nuova identità, reset di conversazione, risultato a zero, processo ripreso (`:8460`).
- Capacità 1M conservata quando il risultato riporta 200k (`:9979`, `:6624`); finestre malformate ignorate (`:6704`); usi sovradimensionati tagliati (`:6476`); turni completati anche se la richiesta di contesto si blocca (`:10203`).
- Contesto vivo tenuto solo per lo stesso modello, con budget 150.000 e 1.000.000 (`:10127`).

Accesso:
- Pronto quando `claude` è installato e autenticato (`provider/Layers/ProviderHealth.test.ts:1471`); chiusura difensiva per Auto con versione illeggibile (`:1495`); binario configurato usato per entrambe le prove (`:1522`).
- Credenziali dirette obsolete tolte quando l'OAuth locale è utilizzabile (`:1545`); OAuth creduto solo dopo la prova SDK (`:1626`, `:1683`).
- Testo di login fallito tenuto come non autenticato (`:1730`); ripetizione unica del falso negativo strutturato (`:1780`) e persistenza del negativo dopo il ritento (`:1829`); errore di auth non conservato dopo un timeout transitorio (`:932`).
- Parsing: exit 0 senza marcatori pronto (`:2658`), `loggedIn=true` (`:2664`), `loggedIn=false` (`:2674`), JSON senza marcatore avviso (`:2684`); JSON malformato con exit 0 non è autenticato (`provider/claudeAuthStatus.malformedJson.test.ts:6`).
- Lock: FIFO senza sovrapposizioni (`provider/claudeAuthStatusLock.test.ts:14`), passaggio solo dopo il rilascio (`:43`), doppio rilascio innocuo (`:60`).
- Ambiente: credenziali locali preferite a quelle dirette obsolete (`provider/claudeProcessEnv.test.ts:15`), credenziali dirette tenute senza login locale (`:39`), nessuna autorità del piano di controllo di Synara verso Claude (`:50`), `HOME` allineata (`:67`), backend compatibili rispettati (`:79`), `CLAUDE_CONFIG_DIR` prima della home (`:92`).
- MCP: voce http con header bearer (`apps/server/src/agentGateway/mcpInjection.test.ts:190`); politica dell'harness additiva con credenziali e onesta senza (`provider/Layers/ClaudeAdapter.test.ts:689`, `:698`).

### In Trama

- `ClaudeClient` implementa il `protocol ProviderAdapter` della sezione 5, con le capacità della tabella sopra copiate in `ProviderCapabilities`.
- Trasporto: qui sta la differenza grossa. Trama non ha `@anthropic-ai/claude-agent-sdk`, quindi deve fare da sola quello che l'SDK fa: un `Process` che avvia `claude` con `stdin` e `stdout` su `Pipe`, `stderr` ereditato, e un dialogo a messaggi JSON su stdio. I dettagli del protocollo, cioè i nomi dei messaggi, la forma delle richieste di controllo e il canale dei permessi, non sono scritti nel codice di Synara: stanno nella sezione "Verifiche da fonti primarie". Finché quella verifica non è chiusa, tutto quello che segue vale come mappatura delle intenzioni, non come contratto di byte.
- `actor ClaudeSession` per thread: possiede il `Process`, la coda dei prompt, i permessi in sospeso, l'osservazione della cache e la contabilità dei token. Le richieste di controllo (`setModel`, `setPermissionMode`, `applyFlagSettings`, `getContextUsage`, `supportedCommands`, `supportedModels`) diventano metodi `async` dell'actor, ognuna con la sua scadenza: 1 s per l'uso di contesto, 10 s per l'interruzione.
- Messaggi in arrivo come `AsyncStream<ClaudeMessage>`, con `Codable` per le forme note e `JSONValue` per i payload che cambiano. I messaggi non riconosciuti si segnalano una volta sola per tipo, come fa `warnUnhandledSdkKind` (`ClaudeAdapter.ts:2584-2600`).
- Opzioni: `struct ClaudeQueryOptions: Encodable` che ricalca la tabella sopra. Le costanti da portare invariate sono `settingSources` (`["user","project","local"]`), `includePartialMessages`, `forwardSubagentText`, `excludeDynamicSections`, `autoCompactEnabled`.
- Permessi: `canUseTool` diventa una richiesta dal processo verso Trama, servita dall'actor con le stesse cinque regole in ordine. `AskUserQuestion` e `ExitPlanMode` restano casi a parte, perché cambiano l'esperienza in chat.
- Accesso: `struct ClaudeAccessProbe` con due `Process` (`claude --version`, `claude auth status`), timeout 20 s, le stesse quattro regole di testo. Il lock FIFO diventa un `actor ClaudeAuthStatusGate` con un solo posto: è la parte più facile da portare e la più facile da dimenticare.
- Cursore: JSON opaco con `resume`, `resumeSessionAt`, `turnCount`, `trackedTasks`, `processedTokenTotal`, `tokenAccountingVersion` e `claudeCache`, con la stessa lettura difensiva, incluso il vincolo che `claudeCache.nativeSessionId` deve combaciare con `resume`.
- Token e cache: `claudeTokenUsage.ts` e `claudeCacheObservation.ts` sono funzioni pure, si traducono quasi riga per riga in `struct` e funzioni libere, con test presi dagli stessi casi.
- Modello: Synara usa `claude-sonnet-5` come predefinito; per Codex le prove reali di Trama usano solo `gpt-5.6-luna` (`docs/adr/0008-provider-di-synara-in-swift.md`, riga "Conseguenze", nel repository Trama).
- Strumenti host: la voce MCP http con header `Authorization: Bearer ...` è la forma più semplice dei nove provider, e non richiede file di configurazione.

### Da non portare

- Effect-TS: `Effect.gen`, `ServiceMap.Service`, `Layer`, `Deferred`, `Ref`, `Queue.unbounded`, `Stream.fromQueue`, `Effect.tryPromise`, `Effect.acquireUseRelease` (`provider/Services/ClaudeAdapter.ts:34-36`; `ClaudeAdapter.ts:5097-5105`; `ProviderHealth.ts:1069-1076`).
- Node: `NodeJS.ProcessEnv`, `readFileSync`, `execFile`, `AsyncGenerator`, `AbortController`, il caricamento pigro del modulo per risparmiare 26 ms all'avvio (`provider/claudeAgentSdk.ts:10-20`; `claudeProcessEnv.ts:5-9`; `ClaudeAdapter.ts:556-582`).
- Il pacchetto `@anthropic-ai/claude-agent-sdk` come dipendenza: è il motivo di questo ticket.
- Gestione Windows: `isWindowsShellCommandMissingResult` intorno a ogni comando (`ProviderHealth.ts:660-671`).
- Il keepalive della credenziale su macOS (`provider/claudeCredentialKeepalive.ts:21-63`): dipende da un'opzione di ambiente e serve a un problema di Synara che gira come server.
- Workflow, plugin e skill dei plugin: `claudeWorkflowRuntime.ts`, `claudeWorkflowScript.ts`, `claudePluginSkills.ts` stanno fuori dal verticale; le capacità di Claude dichiarano già `supportsSkillDiscovery: false` e `supportsPluginDiscovery: false` (`ClaudeAdapter.ts:6962-6966`).
- Il testo della politica dell'harness di Synara e i nomi degli strumenti `synara_*` (`ClaudeAdapter.ts:1227-1239`): Trama ha i suoi strumenti.
- La prova SDK dentro il controllo di salute (`ProviderHealth.ts:458-499`): serve solo a recuperare un falso negativo di Claude 2.1.x.

### Non trovato

- Protocollo effettivo su stdio: Synara non lo scrive mai, lo delega a `query()` dell'SDK (`ClaudeAdapter.ts:1918-1928`). Cercati nomi di metodo, framing e schemi di messaggio in tutti i file `claude*`: nessuna riga li descrive. Va coperto dalla sezione "Verifiche da fonti primarie".
- Argomenti della riga di comando di `claude` per una sessione: la funzione di spawn riceve `options.command` e `options.args` già pronti dall'SDK e non li ispeziona (`ClaudeAdapter.ts:546-554`).
- `maxTurns`, `plugins`, `appendSystemPrompt`, `strictMcpConfig`, `extraArgs`, `executableArgs`: cercati con grep nell'adattatore, zero occorrenze.
- `allowedTools` e `disallowedTools` nella query di sessione: `disallowedTools` compare solo dentro le definizioni dei subagent (`ClaudeAdapter.ts:1267`), `allowedTools` solo nella prova SDK del controllo di salute (`ProviderHealth.ts:480`).
- `stderr` come callback nelle opzioni di sessione: assente, lo stdio è `inherit` (`ClaudeAdapter.ts:552`); la callback c'è solo nella prova di salute (`ProviderHealth.ts:481`).
- `abortController` nelle opzioni di sessione: assente; l'interruzione passa da `query.interrupt()` (`ClaudeAdapter.ts:6443-6456`).
- Scadenza della cache dei modelli: `cachedModels` è una variabile di layer senza TTL e senza invalidazione (`ClaudeAdapter.ts:1948`, `:6870-6871`). Cercati TTL e timestamp attorno a `listModels`.
- Filtro sulle voci malformate di `supportedModels()`: nessuno nell'adattatore, che accetta `value` e `displayName` così come arrivano (`ClaudeAdapter.ts:926-940`).
- Timeout per `claude auth status` nel keepalive diverso da quello di salute: entrambi 20 s, ma da costanti diverse (`claudeCredentialKeepalive.ts:33`; `ProviderHealth.ts:116`).
- `didResumeSession` per Claude: cercato nell'oggetto restituito (`ClaudeAdapter.ts:6959-6995`), assente.
