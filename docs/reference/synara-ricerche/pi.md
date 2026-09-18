## NN. Provider Pi

Ticket: P09. Pi è l'agente di programmazione di Earendil che Synara esegue dentro il proprio processo server tramite l'SDK TypeScript, senza avviare un processo Pi separato per la conversazione (`apps/server/src/provider/Services/PiAdapter.ts:1-8`).

### Percorsi dei file

- Adattatore: `apps/server/src/provider/Layers/PiAdapter.ts` (3290 righe), interfaccia in `apps/server/src/provider/Services/PiAdapter.ts:14-20`, registrazione in `apps/server/src/provider/runtimeLayer.ts:86-88`.
- Catalogo OpenCode di Pi: `apps/server/src/provider/piOpenCodeCatalog.ts`. Catalogo OpenRouter: `apps/server/src/provider/OpenRouterDiscovery.ts`. Esito dei turni falliti: `apps/server/src/provider/piTurnFailure.ts`.
- Stato di accesso: `checkPiProviderStatus` in `apps/server/src/provider/Layers/ProviderHealth.ts:1417-1491`, invocato in `ProviderHealth.ts:2361-2367`.
- Test: `Layers/PiAdapter.test.ts`, `Layers/PiAdapter.lifecycle.test.ts`, `Layers/PiOpenRouter.test.ts`, `piOpenCodeCatalog.test.ts`, `piTurnFailure.test.ts`, `OpenRouterDiscovery.test.ts` (tutti sotto `apps/server/src/provider/`), più il blocco `checkPiProviderStatus` in `Layers/ProviderHealth.test.ts:2023-2080`.
- Contratti: `packages/contracts/src/model.ts:20-29` e `model.ts:127-130`, `orchestration.ts:162-167` e `orchestration.ts:223-226`, `settings.ts:67-71` e `settings.ts:180-186`, `providerDiscovery.ts:73`, `providerDiscovery.ts:111`, `providerDiscovery.ts:248`.
- Pacchetti in `apps/server/package.json:32-34`: `@earendil-works/pi-agent-core` `^0.85.1`, `@earendil-works/pi-ai` `^0.85.1`, `@earendil-works/pi-coding-agent` `^0.85.1`. Il lockfile risolve tutti e tre a `0.85.1` (`bun.lock:514`, `bun.lock:516`, `bun.lock:518`).

### Trasporto

Synara importa l'SDK come libreria. Dal pacchetto `@earendil-works/pi-coding-agent` usa i tipi `BashOperations`, `ModelRegistry`, `ModelRuntime`, `SessionManager`, `AgentSession`, `AgentSessionEvent`, `CreateAgentSessionRuntimeFactory`, `ExtensionUIContext`, `ToolDefinition` (`Layers/PiAdapter.ts:6-16`). Da `@earendil-works/pi-agent-core` usa `AgentToolResult` e `ThinkingLevel` (`PiAdapter.ts:17`); da `@earendil-works/pi-ai` usa `Api`, `ImageContent`, `Model`, `TextContent` (`PiAdapter.ts:18`) e la funzione `openrouterProvider` da `@earendil-works/pi-ai/providers/openrouter` (`PiAdapter.ts:84`). Il catalogo OpenCode importa `opencodeProvider` da `@earendil-works/pi-ai/providers/opencode` (`piOpenCodeCatalog.ts:2`).

Il modulo `pi-coding-agent` si carica in modo pigro, perché porta con sé un modulo nativo per gli appunti (`PiAdapter.ts:348-353`). Funzioni del modulo chiamate a runtime: `ModelRuntime.create` (`PiAdapter.ts:1265`), `ModelRegistry` (`PiAdapter.ts:1305`), `getAgentDir` (`PiAdapter.ts:1255`), `getShellConfig` (`PiAdapter.ts:2513`), `SessionManager.open` e `SessionManager.create` (`PiAdapter.ts:2521-2523`), `createAgentSessionServices`, `createAgentSessionFromServices`, `createAgentSessionRuntime` (`PiAdapter.ts:2453`, `PiAdapter.ts:2476`, `PiAdapter.ts:2497`), `defineTool` e `createBashToolDefinition` (`PiAdapter.ts:2483-2484`).

Sulla sessione (`runtime.session`) Synara usa `prompt` con `preflightResult` (`PiAdapter.ts:1865-1874`), `followUp` (`PiAdapter.ts:1964`), `steer` (`PiAdapter.ts:1979`), `abort` e `clearQueue` (`PiAdapter.ts:2083-2084`), `abortRetry` (`PiAdapter.ts:2109`), `setModel` e `setThinkingLevel` (`PiAdapter.ts:1939`, `PiAdapter.ts:1950`), `reload` (`PiAdapter.ts:2005`), `compact` (`PiAdapter.ts:3054`), `subscribe` (`PiAdapter.ts:2658`), `bindExtensions` (`PiAdapter.ts:2664`), `getSessionStats` (`PiAdapter.ts:1745`), `sessionManager.getLeafId`, `branch`, `resetLeaf` (`PiAdapter.ts:1749`, `PiAdapter.ts:3043-3045`), e `runtime.dispose` (`PiAdapter.ts:2122`).

L'unico processo figlio che Synara avvia per la conversazione è la shell dello strumento `bash`: `makePiBashProcessSupervisor` implementa `BashOperations.exec`, avvia la shell in un gruppo di processi proprio e dimostra l'uscita dell'albero prima di chiudere (`PiAdapter.ts:211-346`). L'ambiente del figlio eredita tutte le variabili (`providerChildEnvironment.ts:67`, chiamata in `PiAdapter.ts:262-265`).

### Controllo di accesso

`checkPiProviderStatus(agentDir, binaryPath)` esegue solo `pi --version` (eseguibile predefinito `pi`), senza importare l'SDK (`ProviderHealth.ts:1419-1434`). `available` è sempre `true` e `authStatus` è sempre `"unknown"`:

- CLI assente: `warning`, "Pi SDK is bundled, but the Pi CLI (`pi`) is not on PATH, so Synara could not verify the installed CLI version." (`ProviderHealth.ts:1434-1447`).
- Errore di avvio: `warning`, "Pi SDK is bundled, but the CLI health check failed: <errore>." (`ProviderHealth.ts:1445`).
- Timeout: `warning`, "Pi SDK is bundled, but the CLI health check timed out before Synara could verify the installed version." (`ProviderHealth.ts:1449-1459`).
- Uscita non zero: `warning`, "Pi SDK is bundled, but the CLI health check failed. <dettaglio>" oppure senza dettaglio (`ProviderHealth.ts:1462-1474`).
- Successo: `ready` con la versione letta, messaggio "Pi CLI is installed. Synara will use Pi agent dir <dir>." se è configurata una cartella, altrimenti "Pi CLI is installed. Configure provider credentials inside Pi as needed." (`ProviderHealth.ts:1477-1489`).

Il controllo gira solo se Pi è attivo nelle impostazioni e riceve `settings.providers.pi.agentDir` e `binaryPath` (`ProviderHealth.ts:2361-2367`). Per gli aggiornamenti il pacchetto npm è `@earendil-works/pi-coding-agent`, senza Homebrew, con `pi update` (`ProviderHealth.ts:269-280`). Synara non verifica le credenziali: le gestisce Pi nel file `auth.json` della cartella agente (`PiAdapter.ts:1265-1268`), e le richieste pubbliche di catalogo non portano credenziali (`OpenRouterDiscovery.ts:1`, `piOpenCodeCatalog.ts:69-70`).

### Catalogo modelli

`listModels` crea un `ModelRuntime` nuovo, aggiorna il catalogo OpenCode, crea i servizi di sessione, aggiorna OpenRouter e legge il registro (`PiAdapter.ts:3070-3091`). Risultato: `source` vale `"pi.sdk+extensions"` se ci sono estensioni caricate, altrimenti `"pi.sdk"`, con `cached: false` (`PiAdapter.ts:3093-3097`). Sopra c'è la cache generica di Synara, valida per tutti i provider: 10 minuti fresca, 24 ore stantia, 30 secondi per i fallimenti (`providerModelDiscoveryCache.ts:18-30`, `ProviderDiscoveryService.ts:96-100`). Nel contratto Pi non ha modelli statici: "Pi discovery owns the live catalog" (`packages/contracts/src/model.ts:898-899`).

- Registro: `getAvailable()` più i modelli Anthropic garantiti (`claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-8`) quando Anthropic è autenticato ma un'estensione li ha tolti (`PiAdapter.ts:122-181`, `PiAdapter.ts:592-635`).
- Descrittore: `slug` è `provider/id`; una voce con provider o id vuoti, o con spazi ai bordi, si scarta restituendo `null` (`PiAdapter.ts:642-672`). Lo scarto è silenzioso, senza avviso (`PiAdapter.ts:3085-3091`).
- Risoluzione: accetta `provider/id` o `provider:id`; se il modello manca crea un ripiego con 128000 di contesto e 16384 in uscita, tranne per OpenCode Zen, che mescola quattro protocolli (`PiAdapter.ts:678-761`).
- OpenCode: scarica `https://pi.dev/api/models/providers/opencode` e `https://opencode.ai/zen/v1/models` in parallelo, timeout 5 secondi, e tiene in memoria il risultato per 60 secondi (`CATALOG_TTL_MS = 60_000`) (`piOpenCodeCatalog.ts:6-8`, `piOpenCodeCatalog.ts:92-123`). Salta se `PI_OFFLINE` è impostata, se manca l'autenticazione `opencode` o se un endpoint è personalizzato (`piOpenCodeCatalog.ts:82-84`). Tiene solo modelli attivi nell'inventario con metadati completi e uno dei quattro protocolli noti (`piOpenCodeCatalog.ts:10-15`, `piOpenCodeCatalog.ts:21-71`). Qualsiasi errore lascia il catalogo di base dell'SDK (`piOpenCodeCatalog.ts:143-144`).
- OpenRouter: `GET https://openrouter.ai/api/v1/models`, timeout 5 secondi, massimo 8 MiB (`OpenRouterDiscovery.ts:23-39`). Tiene solo modelli con testo in entrata e in uscita, supporto `tools`, contesto e token massimi positivi e prezzi validi; `reasoning` vale vero se compaiono `reasoning` o `reasoning_effort` (`OpenRouterDiscovery.ts:63-93`). Ogni errore restituisce una lista vuota (`OpenRouterDiscovery.ts:96-97`). Il recupero parte solo senza `PI_OFFLINE`, con autenticazione `openrouter`, senza estensione che registri `openrouter` e con l'URL di base standard (`PiAdapter.ts:1273-1281`). I modelli si registrano sotto `models.json`, così le modifiche dell'utente vincono (`PiAdapter.ts:1287-1298`). Per OpenRouter non c'è una cache di 60 secondi.

### Opzioni

- Livelli di thinking nel contratto: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (`packages/contracts/src/model.ts:20-29`). `PiModelOptions` ha solo `thinkingLevel` (`model.ts:127-130`); `PiModelSelection` è `{ provider: "pi", model, options? }` (`orchestration.ts:162-167`).
- Predefinito: `medium` (`PiAdapter.ts:100`), segnato `isDefault` nelle etichette (`PiAdapter.ts:106-114`) e passato alla sessione se non ne arriva un altro (`PiAdapter.ts:2481`). Il descrittore dichiara `defaultReasoningEffort: "medium"` solo se il modello supporta quel livello (`PiAdapter.ts:666-668`).
- Livelli per modello: nessuno se il modello non ragiona; con `thinkingLevelMap` un livello `null` è escluso e `xhigh`/`max` compaiono solo se mappati; senza mappa valgono `off` fino a `high` (`PiAdapter.ts:115-121`, `PiAdapter.ts:553-585`).
- Avvio: `PiProviderStartOptions` ha `binaryPath` e `agentDir` (`orchestration.ts:223-226`). Impostazioni server: `binaryPath` predefinito `"pi"`, `agentDir` predefinito vuoto (`settings.ts:67-71`). Una cartella vuota usa `getAgentDir()` dell'SDK (`PiAdapter.ts:1251-1256`).
- Cambio di modello a sessione aperta: `setModel`, poi `setThinkingLevel` se il livello è valido; modello sconosciuto dà "Pi model '<m>' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'." (`PiAdapter.ts:1928-1952`).

### Capacità dichiarate

Oggetto `capabilities` (`PiAdapter.ts:3255-3264`):

```ts
sessionModelSwitch: "in-session",
supportsSkillMentions: true,
supportsSkillDiscovery: true,
supportsNativeSlashCommandDiscovery: true,
supportsPluginMentions: false,
supportsPluginDiscovery: false,
supportsRuntimeModelList: true,
supportsTurnSteering: true,
```

`conversationRollback` e `supportsLiveTurnDiffPatch` sono omessi. `getComposerCapabilities` aggiunge `supportsThreadCompaction: true` e `supportsThreadImport: false` (`PiAdapter.ts:3227-3238`). `respondToRequest` fallisce sempre con "Pi does not expose Synara approval/user-input requests for thread <id>." (`PiAdapter.ts:2944-2951`, `PiAdapter.ts:3269`): Synara non aggiunge permessi né modalità piano a Pi (`Services/PiAdapter.ts:4-5`).

### Ciclo di vita e cursore di ripresa

- Avvio (`PiAdapter.ts:2508-2747`): carica l'SDK, calcola la cartella agente, apre il file di sessione dal cursore con `SessionManager.open(file, undefined, cwd)` oppure ne crea uno con `SessionManager.create(cwd)`. Se il thread ha già una sessione la chiude prima. Collega gli eventi, lega le estensioni con un contesto UI ridotto e un gestore di interruzione, poi emette `session.started`, `thread.started` (con `providerThreadId` uguale a `sessionId`) e l'uso iniziale dei token.
- Dove stanno le sessioni: Synara passa solo `cwd` a `SessionManager.create`, quindi la posizione del file la decide l'SDK (`PiAdapter.ts:2523`). Il test la sposta in `<cwd>/sessions` (`PiAdapter.lifecycle.test.ts:30-37`).
- Cursore: è il percorso del file di sessione, letto da `session.sessionFile` o `sessionManager.getSessionFile()` (`PiAdapter.ts:780-782`). In lettura si accetta una stringa oppure un oggetto con `sessionFile`, `sessionFilePath`, `nativeHandle` o `path` (`PiAdapter.ts:763-778`). Torna nella sessione e in ogni risultato di invio (`PiAdapter.ts:784-799`, `PiAdapter.ts:2046-2050`).
- Invio (`PiAdapter.ts:2805-2854`): serializzato per thread da un lucchetto (`PiAdapter.ts:1403-1406`); aspetta la fine della fase preliminare del prompt precedente; con turno attivo mette il messaggio in coda con `followUp` e restituisce lo stesso `turnId` (`PiAdapter.ts:2828-2838`). Rifiuta con "A Pi turn is already active for this thread." se c'è un'interruzione in attesa, se il testo è `/reload` o se un'esecuzione non avviata da Synara è in corso (`PiAdapter.ts:1921-1926`, `PiAdapter.ts:2833-2842`). Altrimenti crea un turno e chiama `prompt` senza attendere (`PiAdapter.ts:2843-2852`).
- `/reload` senza allegati esegue `session.reload()` come turno a sé, chiuso con `stopReason: "reload"` (`PiAdapter.ts:858-860`, `PiAdapter.ts:1954-1956`, `PiAdapter.ts:1989-2044`).
- Steering: con turno vivo chiama `steer`, altrimenti avvia un prompt nuovo (`PiAdapter.ts:2856-2914`).
- Interruzione: ignora un `turnId` vecchio con un avviso nel log; svuota la coda e chiama `abort`; se il prompt è ancora in fase preliminare segna `pendingAbortTurnId` e ripete l'abort all'evento `agent_start` (`PiAdapter.ts:2081-2103`, `PiAdapter.ts:2209-2223`, `PiAdapter.ts:2916-2942`).
- Fine turno: `completePrompt` chiude gli elementi aperti, emette l'uso dei token e `turn.completed`; lo stato viene da `classifyPiTurnFailure`, che segna "interrupted"/"aborted" per testi come "request was aborted" o "retry cancelled" e "failed"/"error" negli altri casi (`PiAdapter.ts:1732-1837`, `piTurnFailure.ts:1-28`). Un `prompt` copre tentativi, compattazione e continuazioni; `agent_end` registra solo l'errore dell'ultimo tentativo (`PiAdapter.ts:1863-1864`, `PiAdapter.ts:2403-2410`).
- Compattazione per overflow: il turno resta aperto finché `prompt` non si risolve, e `compaction_start`/`compaction_end` diventano elementi `context_compaction` (`PiAdapter.ts:2372-2402`). Compattazione manuale con `compactThread` (`PiAdapter.ts:3050-3065`).
- Stop idempotente: senza sessione non fa nulla; altrimenti svuota coda e tentativi, revoca il turno del gateway, risolve con risposte vuote le domande aperte, chiude runtime e processi ed emette `thread.state.changed` `closed` e `session.exited` (`PiAdapter.ts:2105-2144`, `PiAdapter.ts:2969-2999`).
- Rollback: taglia i turni in memoria e sposta la foglia della sessione con `branch(leafId)` o `resetLeaf()` (`PiAdapter.ts:3036-3048`). Lettura del thread dalla cronologia dei messaggi SDK (`PiAdapter.ts:1184-1249`, `PiAdapter.ts:3007-3034`).
- Domande alla persona: solo dalle estensioni Pi (`select`, `confirm`, `input`, `editor`) che diventano `user-input.requested`; le API solo terminale producono un avviso "Pi extension UI API '<m>' is not supported in Synara yet." una volta per metodo (`PiAdapter.ts:1501-1730`, `PiAdapter.ts:2953-2967`). Con estensioni caricate parte un avviso fisso sul ponte UI limitato (`PiAdapter.ts:2703-2723`).

### Iniezione degli strumenti host

Synara non configura un server MCP dentro Pi. Prende una concessione del gateway per il thread, legge il catalogo con `tools/list` e trasforma ogni strumento in un `ToolDefinition` nativo con `defineTool`; l'esecuzione chiama `tools/call` sul gateway e inoltra il segnale di annullamento (`PiAdapter.ts:484-519`, `agentGateway/mcpInjection.ts:144-188`). Gli strumenti entrano in `customTools` accanto allo strumento `bash` supervisionato (`PiAdapter.ts:2482-2491`). Un catalogo vuoto è un errore, e se l'installazione fallisce la sessione parte senza strumenti del gateway con un avviso nel log (`PiAdapter.ts:498-500`, `PiAdapter.ts:2546-2583`). Un risultato con `isError` diventa un'eccezione (`PiAdapter.ts:445-457`).

La politica dell'harness Synara si antepone al primo testo inviato, solo se il gateway è disponibile (`PiAdapter.ts:1910-1919`, `agentGateway/harnessPolicy.ts:73-93`). A fine turno la concessione ritira il turno, viene rilasciata e sostituita da una nuova, e la connessione si aggiorna sul posto (`PiAdapter.ts:1794-1816`).

### Eventi d'uso

`normalizeTokenUsage` legge `getSessionStats()`: input, lettura dalla cache, output, totale e `contextUsage` (`PiAdapter.ts:801-856`). La finestra viene da `contextUsage.contextWindow` o dal `contextWindow` del modello; i token usati da `contextUsage.tokens`, poi dalla percentuale, poi dal totale limitato alla finestra. Se tutto è zero e non c'è finestra, non emette nulla (`PiAdapter.ts:833-842`). L'evento `thread.token-usage.updated` parte all'avvio e a fine turno (`PiAdapter.ts:2734-2745`, `PiAdapter.ts:1778-1785`), e `turn.completed` porta le statistiche grezze in `usage` (`PiAdapter.ts:1823-1836`). Gli eventi grezzi hanno `source: "pi.sdk.event"` (`packages/contracts/src/providerRuntime.ts:33`).

Mappatura: `agent_start` dà `thread.state.changed` `active`; `turn_start` dà `turn.started` con modello e `effort`; `text_delta` e `thinking_delta` danno `content.delta` `assistant_text` e `reasoning_text`; `tool_execution_*` danno `item.started`/`updated`/`completed`; `auto_retry_start` dà `runtime.warning` (`PiAdapter.ts:2146-2432`). Tipi di strumento: `bash` è `command_execution`, `edit`/`write` sono `file_change`, `grep`/`find` sono `web_search`, il resto `dynamic_tool_call` (`PiAdapter.ts:1044-1057`).

### Casi limite dai test

- `Layers/PiAdapter.test.ts:31` (uses canonical MCP schemas and keeps same-cwd thread tokens distinct)
- `Layers/PiAdapter.test.ts:100` (forwards Pi tool cancellation to the in-flight MCP request)
- `Layers/PiAdapter.test.ts:150` (keeps an aborted command pending until process-tree exit is proven)
- `Layers/PiAdapter.test.ts:216` (normalizes the malformed Pi extension model metadata before returning it through RPC)
- `Layers/PiAdapter.test.ts:235` (omits models whose normalized identity would no longer resolve in the registry)
- `Layers/PiAdapter.test.ts:260` (isolates extension providers between sessions that share an agent directory)
- `Layers/PiAdapter.test.ts:387` (restores Fable 5 and Opus 4.8 after an extension replaces the Anthropic catalog)
- `Layers/PiAdapter.test.ts:450` (does not invent Anthropic models when Anthropic is unauthenticated)
- `Layers/PiAdapter.test.ts:515` (advertises xhigh and max only when the concrete Pi model supports them)
- `Layers/PiAdapter.test.ts:549` (respects provider-level disabled thinking levels)
- `Layers/PiAdapter.test.ts:602` (keeps original select values while showing normalized unique labels)
- `Layers/PiAdapter.lifecycle.test.ts:335` (does not turn extension footer status into transcript tool progress)
- `Layers/PiAdapter.lifecycle.test.ts:415` (keeps one turn through a real SDK retry and settles text, reasoning and usage once)
- `Layers/PiAdapter.lifecycle.test.ts:470` (settles cancellation in retry backoff through %s abort without another agent_end)
- `Layers/PiAdapter.lifecycle.test.ts:533` (keeps steering during backoff inside the same logical turn)
- `Layers/PiAdapter.lifecycle.test.ts:557` (queues a send during an active turn as an SDK follow-up instead of erroring)
- `Layers/PiAdapter.lifecycle.test.ts:588` (serializes a concurrent send dispatching behind a committing prompt)
- `Layers/PiAdapter.lifecycle.test.ts:608` (does not strand a concurrent send when the committing prompt is an extension command)
- `Layers/PiAdapter.lifecycle.test.ts:687` (aborts a turn interrupted while its prompt is still committing)
- `Layers/PiAdapter.lifecycle.test.ts:716` (rejects a send to a turn whose interrupt is pending while still committing)
- `Layers/PiAdapter.lifecycle.test.ts:749` (rejects steering into an untracked SDK run instead of orphaning a queued turn)
- `Layers/PiAdapter.lifecycle.test.ts:774` (keeps the turn alive through SDK overflow compaction and its continuation)
- `Layers/PiAdapter.lifecycle.test.ts:795` (does not let an old prompt rejection settle a replacement session's turn)
- `Layers/PiAdapter.lifecycle.test.ts:836` (disposes during SDK backoff without a resumed request or late turn completion)
- `Layers/PiAdapter.lifecycle.test.ts:944` (retires or revokes the gateway turn authority once on %s)
- `Layers/PiAdapter.lifecycle.test.ts:991` (does not reuse a previous provider error for a handled extension command)
- `Layers/PiAdapter.lifecycle.test.ts:1010` (cancels retry and queued steering before awaiting gateway teardown drainage)
- `Layers/PiOpenRouter.test.ts:65` (passes a listed live model with its real capacities to a fresh session, including offline fallback)
- `Layers/PiOpenRouter.test.ts:108` (does not fetch for absent auth, custom endpoints, or extension-owned catalogs)
- `Layers/PiOpenRouter.test.ts:129` (preserves models.json overrides over live metadata)
- `piOpenCodeCatalog.test.ts:210` (rejects missing Zen metadata but retains custom endpoint fallbacks)
- `piOpenCodeCatalog.test.ts:247` (drops credential-like headers from public model metadata)
- `piOpenCodeCatalog.test.ts:272` (retains the SDK baseline on HTTP failure or malformed/empty inventory)
- `piOpenCodeCatalog.test.ts:292` (cancels requests at the deadline and does not install results after cancellation)
- `piTurnFailure.test.ts:13` (treats retry-backoff cancellation as an interrupted turn)
- `OpenRouterDiscovery.test.ts:56` (skips malformed and unsupported entries without losing valid siblings)
- `Layers/ProviderHealth.test.ts:2067` (keeps Pi usable when the advisory CLI probe is missing)

### In Trama

Il trasporto dipende dall'esistenza di un canale nativo di Pi verso un'altra app: Trama non può caricare le librerie TypeScript, quindi vedi la sezione Verifiche da fonti primarie prima di scegliere. Indipendentemente dal trasporto si portano:

- il catalogo: OpenCode (due URL, inventario attivo, quattro protocolli, cache di 60 secondi, niente intestazioni pubbliche) e OpenRouter (filtri su testo, `tools`, contesto, prezzi), con scarto dei modelli malformati;
- le opzioni: `PiModelSelection` separata dagli altri provider, i sette livelli di thinking, `medium` come predefinito e il filtro per modello;
- la coda: invio durante un turno attivo che si accoda allo stesso `turnId` invece di fallire, con i tre rifiuti espliciti;
- la compattazione: il turno resta aperto fino alla fine dell'intera richiesta, tentativi e continuazioni compresi, con elementi `context_compaction`;
- la classificazione di interruzione contro fallimento, il cursore come percorso opaco del file di sessione, lo stato di accesso con `authStatus` sempre `unknown`.

### Da non portare

- Il caricamento pigro del modulo e la nota sul modulo nativo degli appunti (`PiAdapter.ts:348-353`): è un problema di Node.
- Il supervisore della shell `bash` (`PiAdapter.ts:211-346`) e il ponte UI delle estensioni con il tema senza colori (`PiAdapter.ts:1353-1390`, `PiAdapter.ts:1582-1730`), se Pi gira fuori da Trama.
- I modelli Anthropic garantiti con prezzi scritti a mano (`PiAdapter.ts:122-181`): coprono un difetto di una vecchia estensione.
- La serializzazione con Effect (`makeKeyedLock`, `Effect.runFork`) e il registro NDJSON degli eventi nativi (`PiAdapter.ts:1403-1430`).

### Non trovato

- Cache di 60 secondi per OpenRouter: cercati `TTL`, `60_000` e una variabile di cache in `OpenRouterDiscovery.ts` e in `refreshPiOpenRouterModels`. Il TTL di 60 secondi esiste solo per il catalogo OpenCode (`piOpenCodeCatalog.ts:8`); OpenRouter si scarica a ogni `listModels` e a ogni avvio con modello OpenRouter assente, sotto la cache generica di 10 minuti.
- Avviso per voci di catalogo malformate: cercati `logWarning` e `warning` in `listModels`, `toPiProviderModelDescriptor`, `parsePiOpenCodeCatalog` e `fetchOpenRouterModels`. Le voci si scartano in silenzio.
- Percorso predefinito dei file di sessione e della cartella agente: Synara delega a `SessionManager.create(cwd)` e `getAgentDir()` dell'SDK; nessun percorso letterale nel codice Synara.
- Controllo di autenticazione di Pi: cercati `auth`, `login` e `hasConfiguredAuth` in `ProviderHealth.ts`. Nessuno; `authStatus` è sempre `unknown`.
- Richieste di approvazione degli strumenti: `respondToRequest` non è supportato e nessun evento `request.opened` nasce in `PiAdapter.ts`.
- Canale nativo di Pi verso altre app (processo, RPC, socket): fuori da questa sezione, affidato alla verifica separata.
