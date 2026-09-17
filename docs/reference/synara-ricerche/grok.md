## NN. Provider Grok

Ticket: P04 (runtime ACP condiviso).

Grok è il provider Synara che pilota la CLI Grok Build (`grok agent ... stdio`) parlando ACP su un processo figlio. Non ha un server HTTP proprio: tutto passa dal runtime ACP condiviso descritto in `docs/reference/synara-ricerche/acp.md` (sezione "NN. Runtime ACP condiviso"), che qui non viene riscritto. Questo file copre solo ciò che è proprio di Grok.

Fonti principali: `apps/server/src/provider/Layers/GrokAdapter.ts` (2629 righe), `apps/server/src/provider/acp/GrokAcpSupport.ts`, `apps/server/src/provider/acp/GrokAcpExtension.ts`, lo stato di accesso in `apps/server/src/provider/Layers/ProviderHealth.ts`.

### Percorsi dei file

| File | Ruolo |
|---|---|
| `apps/server/src/provider/Layers/GrokAdapter.ts` | Adattatore completo: sessione, turni, eventi, fork, compact, listModels, watchdog |
| `apps/server/src/provider/acp/GrokAcpSupport.ts` | Costruzione comando ACP, risoluzione auth, `/compact`, selezione modello |
| `apps/server/src/provider/acp/GrokAcpExtension.ts` | Schema e risposte delle estensioni `x.ai/*` (ask, exit plan) |
| `apps/server/src/provider/Services/GrokAdapter.ts` | Contratto del servizio (`GrokAdapterShape`, `provider: "grok"`) |
| `apps/server/src/provider/Layers/ProviderHealth.ts` | `makeCheckGrokProviderStatus` / `checkGrokProviderStatus` |
| `apps/server/src/provider/Layers/GrokAdapter.test.ts` | Test dei soli helper puri dell'adattatore |
| `apps/server/src/provider/acp/GrokAcpSupport.test.ts` | Test di spawn, auth, permessi, `/compact`, selezione modello |
| `packages/contracts/src/model.ts` | `GrokModelOptions`, `GROK_REASONING_EFFORT_OPTIONS`, capacità e catalogo statico |
| `packages/shared/src/model.ts` | `normalizeGrokModelOptions`, `getModelCapabilities`, `resolveGrokEffortFamily` |
| `apps/server/src/providerChildEnvironment.ts` | Allowlist ambiente del figlio Grok |

### Trasporto

Il comando e l'eseguibile sono in `buildGrokAcpSpawnInput` (`GrokAcpSupport.ts:84-112`):

- Base: `--permission-mode default agent --no-leader` (`GrokAcpSupport.ts:91`).
- Con `runtimeMode === "full-access"` si aggiunge `--always-approve` (`GrokAcpSupport.ts:93`). Il commento sopra spiega che la modalità richiesta resta la base esplicita e che Full Access ha bisogno anche dell'override a livello di processo, perché alcune build negano prima di emettere la richiesta di permesso ACP (`GrokAcpSupport.ts:85-90`).
- `-m <model>` se impostato (`GrokAcpSupport.ts:95-98`), `--reasoning-effort <effort>` se impostato (`GrokAcpSupport.ts:99-102`), poi `stdio` come ultimo argomento (`GrokAcpSupport.ts:103`).
- `command` è `grokSettings.binaryPath || "grok"` (`GrokAcpSupport.ts:106`), `cwd` passato dall'adattatore, `env` da `buildProviderChildEnvironment({ provider: "grok" })` (`GrokAcpSupport.ts:107-110`).

Esempio verificato in `GrokAcpSupport.test.ts:23-33`: spawn di default `command: "grok"`, `args: ["--permission-mode","default","agent","--no-leader","stdio"]`. Con modello ed effort: `["--permission-mode","default","agent","--no-leader","-m","grok-build","--reasoning-effort","high","stdio"]` e nessun `--always-approve` (`GrokAcpSupport.test.ts:60-86`). Full Access: `["--permission-mode","default","agent","--no-leader","--always-approve","stdio"]` (`GrokAcpSupport.test.ts:88-96`).

Il commento del modulo dichiara `grok agent ... stdio` (`GrokAdapter.ts:2-4`). Il resto del trasporto (JSON-RPC su stdio, limiti di frame, code, gate di replay) è quello condiviso e non viene duplicato qui.

`freshSessionRetry` è specifico di Grok: `makeGrokAcpRuntime` passa `{ shouldRetry: isGrokSessionStoragePathNotFoundError, delayMs: 100 }` (`GrokAcpSupport.ts:203-206`). Il predicato accetta solo un `AcpRequestError` il cui `data.code` è esattamente `FS_NOT_FOUND` (`GrokAcpSupport.ts:40-50`); la costante del delay è `GROK_SESSION_STORAGE_RETRY_DELAY_MS = 100` (`GrokAcpSupport.ts:47`). Il codice stabile è `GROK_SESSION_STORAGE_NOT_FOUND_CODE = "FS_NOT_FOUND"` (`GrokAcpSupport.ts:46`).

`GROK_SESSION_META` è la meta di sessione inviata a `session/new` e `session/load`: `{ "x.ai/hooks": { PreToolUse: [{ matcher: "*", hookCallbackIds: ["synara-plan-guard"] }] } }` (`GrokAdapter.ts:230-240`, id alla riga `:229`). Il commento nel corpo dello `startSession` dice che Grok registra gli hook del client dalla meta di setup e non da `initialize.clientCapabilities`, quindi la meta va rinviata anche su load/resume (`GrokAdapter.ts:1077-1079`).

### Controllo di accesso

Autenticazione risolta in `resolveGrokAcpAuthMethodId` (`GrokAcpSupport.ts:128-180`), con metodo preferito:

- `xai.api_key` (`GROK_API_KEY_AUTH_METHOD_ID`, `GrokAcpSupport.ts:34`) se c'è una chiave in ambiente e la CLI lo annuncia.
- Altrimenti `cached_token` (`GROK_CACHED_TOKEN_AUTH_METHOD_ID`, `GrokAcpSupport.ts:35`).
- Metodi solo interattivi riconosciuti: `browser_login`, `grok.com` (`GROK_INTERACTIVE_AUTH_METHOD_IDS`, `GrokAcpSupport.ts:36`).

Chiavi accettate: `XAI_API_KEY` e `GROK_CODE_XAI_API_KEY` (`GROK_API_KEY_ENV_KEYS`, `GrokAcpSupport.ts:37`; lettura in `getGrokApiKeyEnv`, `GrokAcpSupport.ts:52-61`). Sono le stesse due chiavi nella allowlist del processo figlio Grok (`providerChildEnvironment.ts:59`, grant `grok: new Set(["XAI_API_KEY","GROK_CODE_XAI_API_KEY"])`).

Errori tipizzati con `reason` nei dati:

- Chiave presente ma metodo assente dalla lista annunciata → `-32602`, "Grok did not advertise API-key authentication", `reason: "compatibility_mismatch"` (`GrokAcpSupport.ts:154-161`).
- Metodo API-key annunciato ma chiave mancante → `-32602`, "XAI_API_KEY is not set", `reason: "credentials_missing"` (`GrokAcpSupport.ts:139-146`).
- Solo metodi interattivi senza chiave → `-32602`, invito a `grok login`, `reason: "credentials_missing"` (`GrokAcpSupport.ts:147-153`).
- Nessun metodo supportato → `-32602`, `reason: "compatibility_mismatch"` (`GrokAcpSupport.ts:162-171`).

`authenticateMeta` è `{ headless: true }` (`GrokAcpSupport.ts:202`).

Permessi: l'adattatore passa da `resolveAcpPermissionPolicy` con `runtimeMode` e `activeInteractionMode` (`GrokAdapter.ts:1196-1198`). Se la policy non decide, apre una `session/request_permission` verso la persona con `makeAcpRequestOpenedEvent` e attende la `Deferred` (`GrokAdapter.ts:1225-1290` circa). La scelta dell'opzione usa `selectAcpPermissionOptionId` (`GrokAdapter.ts:96-101`, uso in `:1270-1290`). `cancel` produce `{ outcome: "cancelled" }`. I casi della policy sono provati in `GrokAcpSupport.test.ts:256-291`: `approval-required` restituisce `undefined` (chiedi), `full-access` auto-consente con `allow_once`, Plan resta fail-closed anche in Full Access e sceglie `reject_once`.

Stato di accesso in `ProviderHealth.ts`: `makeCheckGrokProviderStatus` (`ProviderHealth.ts:1231-1300` circa). Fa solo un probe `grok --version` con `runGrokCommand` e timeout `DEFAULT_TIMEOUT_MS = 4_000` (`ProviderHealth.ts:126-131`, `:52`). Se il probe riesce restituisce `status: "ready"`, `available: true` e `authStatus` `authenticated` se c'è una chiave in ambiente (etichetta `xAI API Key`), altrimenti `unknown` con il messaggio che invita a eseguire `grok` localmente o a impostare `XAI_API_KEY`. Non esiste un probe di login come per Codex/Claude: la sola presenza della chiave determina l'etichetta `apiKey`. Grok è nella lista `PROVIDERS` (`ProviderHealth.ts:91-102`) ma **non** in `PACKAGE_MANAGED_PROVIDER_UPDATES` (`ProviderHealth.ts:151-256`), quindi Synara non offre un aggiornamento pacchetto/HB per Grok.

### Catalogo modelli

`listModels` (`GrokAdapter.ts:2101-2217` circa) prova due sorgenti e le combina:

1. CLI: spawna `<binaryPath> models` con `makeEffectProcessCommand` e raccoglie stdout/stderr/exit code (`GrokAdapter.ts:2110-2140` circa). `parseGrokCliModelList` legge le righe: cerca `Default model: <slug>` come fallback, poi entra in modalità "Available models:" e per ogni riga estrae slug e, tra parentesi, il marcatore `default` (`GrokAdapter.ts:294-357`).
2. API xAI: solo se c'è una chiave, `GET ${baseUrl}/language-models` con Bearer, base `https://api.x.ai/v1` (`XAI_API_BASE_URL`, `GrokAdapter.ts:179`) sovrascrivibile con `XAI_API_BASE_URL` d'ambiente (`GrokAdapter.ts:474-476`). Policy outbound: timeout 10 s, 1 MB di risposta, nessun redirect, indirizzo pubblico obbligatorio (`GrokAdapter.ts:489-505`). `parseXaiLanguageModelDescriptors` legge `models` o `data` e accetta come alias solo slug che sono `grok-build-0.1` o corrispondono a `/^grok-code-fast(?:-\d+(?:-\d+)?)?$/` (`GrokAdapter.ts:359-408`, filtro in `:519-521`).

`selectGrokDiscoveredModelGroups` preferisce la CLI e scarta l'API quando la CLI risponde (`GrokAdapter.ts:410-425`), con il commento che la CLI è la fonte di verità del picker e l'API xAI annuncia ancora slug `grok-build` ritirati. `mergeGrokModelDescriptors` deduplica per slug lowercase e, per ognuno, prende le capacità da `getModelCapabilities("grok", slug)` e il default effort da `getDefaultEffort` (`GrokAdapter.ts:427-460`). Il risultato ha `source: "grok-cli"` o `"grok-cli+xai-api"` e `cached: false` (`GrokAdapter.ts:2200-2205`). Timeout complessivo `GROK_MODEL_DISCOVERY_TIMEOUT_MS = 15_000` (`GrokAdapter.ts:150`, uso `:2210`).

Nomi visualizzati: `formatGrokModelName` mappa `grok-build-0.1` → "Grok Build 0.1" e `grok-build` → "Grok 4.3", altrimenti `humanizeModelSlug` (`GrokAdapter.ts:446-455`).

Catalogo statico e capacità in `packages/contracts/src/model.ts`: l'unica entry di `MODEL_OPTIONS_BY_PROVIDER.grok` è `grok-4.6` con `GROK_4_6_CAPABILITIES` (`packages/contracts/src/model.ts`, blocco `grok:` del catalogo), e `MODEL_CAPABILITIES_INDEX.grok` viene arricchito con `grok-build-0.1`, `grok-build` (ladder `GROK_BUILD_CAPABILITIES`: none/low/medium/high, default low) e `grok-4.5` (ladder low/medium/high, default high) nel blocco `Object.assign(MODEL_CAPABILITIES_INDEX.grok, {...})`. `GROK_4_6_CAPABILITIES` è low/medium/high/xhigh con default high. La scala dichiarata a livello di tipo è `GROK_REASONING_EFFORT_OPTIONS = ["none","low","medium","high","xhigh"]` (`packages/contracts/src/model.ts:24-27`), con il commento che ogni modello ne usa un sottoinsieme. Modello di default: `grok-4.6` in `DEFAULT_MODEL_BY_PROVIDER`.

Per uno slug sconosciuto `getModelCapabilities` instrada su `resolveGrokEffortFamily` e `grokCapabilitiesForFamily` (`packages/shared/src/model.ts:600-656`): famiglia `build` per slug con "build", "code-fast", `grok-4`, `grok-4.3*`, o non classificabile; `4.5` per `grok-4.5`; `4.6` per `grok-4.6` e successivi. Gli alias persistiti sono in `MODEL_SLUG_ALIASES_BY_PROVIDER.grok`: `grok`, `build`, `code-fast`, `grok-4`, `grok-4.3` puntano a `grok-build-0.1`/`grok-build`; `4.5`/`grok-4.5` e `4.6`/`grok-4.6` alle rispettive versioni.

### Opzioni

`GrokModelOptions` è un solo campo: `reasoningEffort?: Literal(GROK_REASONING_EFFORT_OPTIONS)` (`packages/contracts/src/model.ts`, blocco `GrokModelOptions`). Nessun fastMode, thinking, contextWindow.

`normalizeGrokModelOptions` (`packages/shared/src/model.ts`, funzione omonima) tiene l'effort solo se è non vuoto, presente nella scala del modello e diverso dal default; altrimenti restituisce `undefined`. `resolveGrokRuntimeModelSettings` (`GrokAdapter.ts:560-576`) applica la stessa normalizzazione e produce `{ model, reasoningEffort? }`, che finisce in `effectiveGrokSettings` e quindi negli argomenti di spawn (`GrokAdapter.ts:1030-1041`).

`applyGrokAcpModelSelection` è di fatto un no-op: il commento dice che Grok ACP 0.1.210 annuncia i modelli ma non implementa `session/set_config_option`, quindi modello ed effort sono impostazioni di avvio processo (`GrokAcpSupport.ts:216-231`). Il test `GrokAcpSupport.test.ts:294-340` verifica che non venga chiamato né `setModel` né `setConfigOption`.

Overrides a runtime: `providerOptions?.grok.binaryPath` prevale sul `binaryPath` di configurazione (`GrokAdapter.ts:1032-1038`). `capabilities.sessionModelSwitch` è dichiarato `"restart-session"` (`GrokAdapter.ts:2549-2552`), coerente col fatto che modello ed effort sono argomenti di avvio. `interactionMode` per turno passa da `resolveAcpTurnInteractionMode` (omesso = `default`, mai Plan ereditato) e diventa la `_meta.mode` del prompt (`buildGrokPromptMeta`, `GrokAdapter.ts:257-264`).

### Capacità dichiarate

`getComposerCapabilities` (`GrokAdapter.ts:1979-1994`) restituisce:

- `supportsSkillMentions: false`
- `supportsSkillDiscovery: false`
- `supportsNativeSlashCommandDiscovery: false`
- `supportsPluginMentions: false`
- `supportsPluginDiscovery: false`
- `supportsRuntimeModelList: true`
- `supportsThreadCompaction: true`
- `supportsThreadImport: false`

Capacità dell'adattatore: `capabilities: { sessionModelSwitch: "restart-session" }` (`GrokAdapter.ts:2549-2552`). Non compaiono `conversationRollback`, `supportsTurnSteering`, `supportsLiveTurnDiffPatch`, quindi restano `undefined`.

Metodi della forma servizio implementati: `startSession`, `sendTurn`, `interruptTurn`, `readThread`, `rollbackThread`, `forkThread`, `respondToRequest`, `respondToUserInput`, `stopSession`, `listSessions`, `getComposerCapabilities`, `compactThread`, `listModels`, `hasSession`, `stopAll`, `streamEvents` (`GrokAdapter.ts:2533-2561`). Non implementa `steerTurn`, `startReview`, `listSkills`, `listCommands`, `listPlugins`, `listAgents`, `prewarmVoice`, `transcribeVoice`.

### Ciclo di vita e cursore di ripresa

Cursore: `GROK_RESUME_VERSION = 1` (`GrokAdapter.ts:148`). Forma scritta: `{ schemaVersion: 1, sessionId: <id nativo ACP> }` (`GrokAdapter.ts:1345-1350`), riletta solo se `schemaVersion === 1` e `sessionId` è una stringa non vuota (`parseGrokResume`, `GrokAdapter.ts:440-444`).

`startSession` (`GrokAdapter.ts:988-1690` circa) segue questo ordine:

- Validazione provider e `cwd` (fallback server cwd via `resolveAcpSessionCwd`) (`GrokAdapter.ts:992-1006`).
- Se esiste già una sessione non ferma per il thread, la chiude prima (`GrokAdapter.ts:1013-1016`).
- Acquisisce un lease del gateway agenti (`acquireAgentGatewaySessionLease`, `GrokAdapter.ts:1020-1024`).
- Crea il runtime ACP con `sessionMeta: GROK_SESSION_META`, `clientInfo: { name: "Synara", version: "0.0.0" }`, `resumeSessionId` se il cursore è valido, e `buildMcpServers` se ci sono credenziali gateway (`GrokAdapter.ts:1055-1095`).
- Registra i gestori delle estensioni, poi `acp.start()` (`GrokAdapter.ts:1100-1300`).
- Avvia il watcher d'uscita del lease e il consumatore delle notifiche in una fibra dello scope di sessione (`GrokAdapter.ts:1305-1520`).
- Registra la sessione nella mappa **prima** di completare la configurazione, con una `Deferred` `sessionConfigReady` che fa da cancello per `sendTurn`/`compactThread` (`GrokAdapter.ts:1050-1056`, `:1521-1528`).
- Fuori dal lock, attende `acp.awaitLoadReplayReady` con mappatura errori sensibile a `ctx.stopped`, poi applica la selezione modello (no-op), risolve `sessionConfigReady` ed emette `session.started`, `session.state.changed` (`ready`, motivo "Grok ACP session ready") e `thread.started` con `providerThreadId = started.sessionId` (`GrokAdapter.ts:1552-1650` circa).

Al fallimento dopo la registrazione, `stopSessionInternal` viene chiamato su exit non riuscito (`GrokAdapter.ts:1655-1662`).

`stopSessionInternal` (`GrokAdapter.ts:794-830`): marca `stopped`, cancella il turno del gateway, rilascia il lease, risolve approvazioni pendenti come `cancel` e input utente come risposte vuote, risolve `sessionConfigReady`, interrompe la fibra delle notifiche, chiude lo scope e rimuove la sessione dalla mappa, poi emette `session.exited` con `exitKind: "graceful"`.

`sendTurn` non prende il lock per thread, ma rifiuta con `ProviderAdapterValidationError` se `compactingThread` è vero ("Cannot start a turn while Grok context compaction is in progress") o se `turnStarting` è vero ("Another Grok turn is still starting for this thread") (`GrokAdapter.ts:1730-1765` circa). `startGrokTurn` attende `sessionConfigReady`, attende un'eventuale compact abbandonata, attende il gate di replay e ricontrolla `ctx.stopped` (`GrokAdapter.ts:1770-1815`).

Il turno rifiuta input vuoto: "Turn requires non-empty text or attachments" (`GrokAdapter.ts:1855-1862`). Il prompt è composto da un blocco testo (con blocco allegati) e da blocchi immagine (`GrokAdapter.ts:1828-1853`).

`interruptTurn` (`GrokAdapter.ts:2049-2096` circa) ignora un `turnId` diverso dall'attivo con un warning `grok.acp.stale_interrupt_ignored`, imposta `pendingTurnInterrupted` se il turno sta ancora partendo senza fibra di prompt, poi risolve approvazioni e input pendenti, invia `ctx.acp.cancel` e interrompe la fibra del prompt.

Watchdog: soglia 600 000 ms con override `SYNARA_GROK_TURN_IDLE_TIMEOUT_MS`, intervallo 15 000 ms (`GrokAdapter.ts:163-167`). L'orologio si aggiorna **solo** sugli eventi di progresso ACP (`isAcpTurnProgressEventTag`), non su mode/config/usage (`GrokAdapter.ts:1336-1339`). Al timeout `failGrokTurnAsTimedOut` (`GrokAdapter.ts:1677-1730` circa) cancella il turno del gateway, emette `turn.completed` con `state: "failed"`, `stopReason: null`, messaggio "Grok stopped responding (no activity for Ns); the turn was timed out.", mette la sessione in `error`, forka un `acp.cancel` best-effort e interrompe la fibra del prompt.

Fork: `forkThread` (`GrokAdapter.ts:2480-2570` circa). Se c'è un turno in volo sulla sorgente rifiuta con "The source Grok session has a turn in flight; Synara will rebuild the fork from its retained transcript." Se la sorgente è attiva usa `forkViaAcpRuntime` con timeout 30 s e `unsupportedIssue` che invita al fallback sulla trascrizione; se non è attiva e c'è un cursore, riapre un runtime con `resumeSessionId` (timeout su `session/resume`) e poi fork. Restituisce solo il cursore `{ schemaVersion: 1, sessionId }`, senza avviare il runtime, perché il binding lo registra `ProviderService` (`GrokAdapter.ts:2500-2508`). Timeout `GROK_ACP_FORK_TIMEOUT_MS = 30_000` (`GrokAdapter.ts:153`, errore `grokForkTimeoutError`).

Compact: `compactThread` (`GrokAdapter.ts:1996-2040` circa) attende `sessionConfigReady` fuori dal lock, prende il lock solo per reclamare lo slot con `claimGrokCompactionSlot`, poi esegue `runGrokCompaction` fuori dal lock. `claimGrokCompactionSlot` rifiuta con errori espliciti se la sessione è stata riavviata, se un compact è già in corso, o se c'è un turno attivo/che sta partendo. `runGrokCompaction` chiama `runGrokAcpCompactionCommand` (`GrokAcpSupport.ts:63-83`), che controlla i comandi disponibili: se la lista è vuota procede (build vecchie), se la lista è non vuota ma manca `compact` fallisce con `-32601` e messaggio che invita ad aggiornare Grok; poi invia il prompt `/compact` con `_meta: { mode: "agent" }`. Timeout `GROK_COMPACT_TIMEOUT_MS` = stesso valore del watchdog. Distingue timeout, `stopReason: "cancelled"`, e fallimento registrato del tool di compaction; in caso di successo emette solo `thread.state.changed` con `state: "compacted"` e `detail.reason: "provider.compactThread"` (niente riga `item.completed` per non duplicare).

`rollbackThread` valida `numTurns` intero ≥ 1 e taglia l'array dei turni in memoria (`GrokAdapter.ts:2125-2140` circa). `readThread` restituisce `snapshotProviderTurns(ctx.turns)`.

### Iniezione degli strumenti host

`buildMcpServers` viene passato al runtime solo quando esistono `AgentGatewayCredentials` (`GrokAdapter.ts:1084-1092`) e chiama `buildAcpSynaraMcpServers` (`mcpInjection.ts:284-310`): se l'agente annuncia `agentCapabilities.mcpCapabilities.http` usa un server `type: "http"` con header `Authorization: Bearer <token>`, altrimenti un server stdio che lancia il proxy con `SYNARA_AGENT_GATEWAY_URL` e `SYNARA_AGENT_GATEWAY_TOKEN` in `env`. Il nome del server è sempre `synara` (`mcpInjection.ts:22`).

Il blocco di policy host viene consegnato una sola volta per sessione: `takeGrokSynaraHarnessPolicyTextPart` (`GrokAdapter.ts:141-149`) chiama `takeSynaraHarnessPolicyTextPartForProviderSession` con `provider: "grok"` e `scopedGatewayConnectionAvailable` (vero solo se ci sono credenziali gateway). Il blocco viene messo in testa al prompt con `promptParts.unshift` (`GrokAdapter.ts:1867-1870`) e contiene `<synara_host_context>` con la policy; se il gateway non è disponibile la policy dice esplicitamente di non affermare di aver creato o modificato risorse Synara (`harnessPolicy.ts:69-72`). `grok` è nell'insieme dei provider con MCP thread-scoped (`harnessPolicy.ts:80-90`).

Estensioni proprie registrate con `handleExtRequest` (`GrokAdapter.ts:1101-1192`):

- `x.ai/hooks/run` con schema `Schema.Unknown` e risposta da `resolveGrokPlanHookResponse` (`GrokAdapter.ts:1101-1103`). La risposta è un oggetto vuoto oppure `{ decision: "deny", systemMessage }`; nega solo se la modalità attiva è `plan`, l'`hookCallbackId` è `synara-plan-guard`, l'evento è `pre_tool_use` e il tool non è nella lista `GROK_PLAN_READ_ONLY_TOOL_NAMES` (`GrokAdapter.ts:203-226`, `:283-323`).
- `_x.ai/ask_user_question` e `x.ai/ask_user_question` (`GROK_ASK_USER_QUESTION_METHODS`, `GrokAcpExtension.ts:4-7`): emette `user-input.requested` con le domande estratte, attende la `Deferred`, emette `user-input.resolved` e risponde con `makeGrokQuestionResponse`. La forma della risposta è `{ outcome: "accepted", answers: Record<string, string[]>, annotations: {} }` con le chiavi pari al testo della domanda, oppure `{ outcome: "cancelled" }` se nessuna risposta è valorizzata (`GrokAcpExtension.ts:36-45`, `:60-80`).
- `_x.ai/exit_plan_mode` e `x.ai/exit_plan_mode` (`GROK_EXIT_PLAN_MODE_METHODS`, `GrokAcpExtension.ts:79`): se la modalità attiva è `default` risponde `{ outcome: "approved" }` (la persona ha già approvato l'implementazione); altrimenti estrae `planContent`, emette `turn.proposed.completed` con `planMarkdown`, e dopo `GROK_EXIT_PLAN_RESPONSE_GRACE_MS = 25` ms completa il turno Plan e risponde `{ outcome: "cancelled", feedback: "Synara captured this plan for user review. ..." }` (`GrokAdapter.ts:1142-1190`, `GrokAcpExtension.ts:82-108`). Il commento spiega perché il ritardo: la risposta all'estensione deve arrivare a Grok prima che Synara cancelli la fibra del prompt, altrimenti si ricrea il falso errore "client disconnected".

`GROK_PLAN_MODE_PROMPT_PREFIX` (`GrokAdapter.ts:180-203`) chiede di non implementare né mutare file, di non fare domande di follow-up e di produrre il piano finale. `buildGrokTurnPromptText` antepone il prefisso solo in Plan, lasciando intatto il testo in Default e Debug (`GrokAdapter.ts:243-256`).

### Eventi d'uso

Il consumatore delle notifiche (`GrokAdapter.ts:1315-1550` circa) mappa gli eventi interni ACP:

- `ContentDelta` → `content.delta` via `makeAcpContentDeltaEvent`; aggiorna `activeTurnHadAssistantContent` solo se `isRenderableGrokAssistantDelta` è vero, cioè streamKind diverso da `reasoning_text` e testo non vuoto (`GrokAdapter.ts:415-421`, uso `:1475-1500`).
- `ToolCallUpdated` → `item.updated`/`item.completed` via `makeAcpToolCallEvent`, con id turn-local da `scopeGrokToolCallStateForTurn` (`GrokAdapter.ts:436-442`) e registrazione in `ctx.turnToolCallIds` (`GrokAdapter.ts:1462-1490`). Un tool fallito registra `activeTurnFailedToolDetail` (`GrokAdapter.ts:1477-1480`).
- `PlanUpdated` → `turn.tasks.updated` via `makeAcpPlanUpdatedEvent`, filtrato da `acceptAcpPlanUpdate`.
- `UsageUpdated` → `thread.token-usage.updated` via `makeAcpTokenUsageEvent`, e soprattutto `recordAcpSessionCost(ctx, event.cost)` (`GrokAdapter.ts:1538-1554`).
- `AssistantItemStarted`/`AssistantItemCompleted` gestiscono la riga del messaggio assistente, con soppressione degli item vuoti (`GrokAdapter.ts:1345-1400`).
- `ModeChanged` è ignorato esplicitamente (`GrokAdapter.ts:1344`).

Costi: `recordAcpSessionCost` accetta solo costi USD finiti e non negativi e li salva in `ctx.latestSessionCostUsd` (`AcpAdapterSessionSupport.ts:143-158`). `finalizeAcpActiveTurnCost` produce `{ cumulativeCostUsd }` se presente, e quel valore viene messo in ogni `turn.completed`, sia completato, sia fallito, sia annullato, sia timeout (`AcpAdapterSessionSupport.ts:160-174`; usi in `GrokAdapter.ts:1677-1706`, `:1955-1975`, `:1990-1995`, `:2025-2035`).

Uso token: il commento in `GrokAdapter.ts:1877-1885` avverte che `PromptResponse.usage` di ACP è la **spesa cumulativa di sessione**, non l'occupazione del contesto. Per questo l'adattatore lo conserva su `turn.completed` ma non sintetizza un aggiornamento del misuratore di contesto: l'unica fonte attendibile resta la notifica `usage_update` reale.

### Casi limite dai test

- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:23-33` ("builds the default Grok ACP command").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:35-50` ("uses the configured Grok binary path").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:52-86` ("passes model and reasoning effort without process-wide approval overrides").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:88-96` ("uses Grok's process-scoped approval override only for Full Access").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:99-115` ("matches Grok's stable persistence code").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:117-131` ("does not retry other ACP or filesystem failures").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:145-160` ("prefers the xAI API key auth method when XAI_API_KEY is present").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:162-174` ("still accepts the legacy Grok API key env var").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:176-187` ("falls back to cached token auth when no API key is configured").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:189-203` ("identifies an interactive-only advertisement as missing headless credentials").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:205-216` ("explains when an advertised API-key method has no configured key").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:218-229` ("distinguishes an API-key advertisement mismatch from missing credentials").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:231-247` ("reports unknown or empty auth advertisements as a compatibility mismatch").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:256-291` ("surfaces approval-required requests to Synara", "auto-allows Full Access requests with the provider's request-scoped option", "keeps Plan mode fail-closed above Full Access").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:294-340` ("does not call Grok's unsupported ACP config-option method").
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:343-...` ("runs Grok's advertised /compact command explicitly in agent mode", "keeps /compact compatible when an older Grok ACP advertises no commands", "fails clearly when Grok advertises commands without /compact").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:32-51` ("keeps only reasoning efforts supported by the selected model family").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:53-60` ("delivers private scoped host context once").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:62-137` (plan nativo: "adds Plan instructions without sending a pager-only slash command as model text", "sets Grok's native prompt mode idempotently on every turn", "backs native Plan mode with a fail-closed pre-tool hook", "leaves Default prompts untouched after the native gate is switched explicitly", "uses Grok agent mode for Debug prompts", "accepts current and legacy ACP method names", "extracts the proposed plan from Grok's reverse request", "does not invent a plan when Grok submits an empty plan file", "keeps native plan mode gated after Synara captures the plan", "approves leaving native plan mode only for a later implementation turn", "uses a terminal Plan response as a proposal when Grok omits the extension").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:139-...` (domande: "accepts current and legacy question method names", "maps Synara answers to Grok's question-text keyed response").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts` (scoping: "makes reused ACP assistant segment ids unique per DP turn", "preserves the provider tool id while scoping the runtime item id", "detects Grok compaction tool calls for context compaction UI rows", "only treats visible assistant text as renderable Grok content").
- `apps/server/src/provider/Layers/GrokAdapter.test.ts` (catalogo: "parses xAI language model API responses for picker discovery", "merges Grok CLI and xAI API model lists without duplicates", "humanizes an unknown future Grok family through the shared formatter", "keeps the live Grok CLI catalog instead of retired xAI API slugs", "stamps Grok 4.6 with Extra High instead of the grok-build None ladder").

Nota di perimetro: la suite `ProviderHealth.test.ts` importa `checkGrokProviderStatus` e `makeCheckGrokProviderStatus` (`ProviderHealth.test.ts:27-31`) ma non ho letto i casi Grok specifici dentro quel file; non li cito.

### In Trama

Grok in Trama è un caso del protocollo `Provider`, non un client separato. Quello che segue è la traduzione del comportamento letto, coerente con un'app macOS SwiftUI il cui motore attuale è Codex app-server.

- `protocol GrokProviderExtension` (o un valore `GrokACPProfile`) che riempie i punti di estensione già letti: comando e argomenti, `sessionMeta`, risoluzione del metodo di auth, `freshSessionRetry`, registrazione delle estensioni. Niente ereditarietà: composizione con `ACPSessionRuntime` di Trama.
- Comando come valore puro: `struct GrokSpawnBuilder { func spawn(settings: GrokRuntimeSettings, cwd: String, runtimeMode: RuntimeMode) -> ACPSpawn }`. `RuntimeMode` con casi `approvalRequired` e `fullAccess`; `fullAccess` aggiunge `--always-approve`, modello ed effort aggiungono `-m` e `--reasoning-effort`, `stdio` resta ultimo. Un test puro verifica l'array di argomenti.
- Auth come funzione pura da `InitializeResponse` a `Result<String, ACPStartError>`, con i quattro esiti distinti (chiave presente e metodo annunciato, metodo annunciato senza chiave, solo metodi interattivi, nessun metodo supportato) e `reason` nell'errore. La chiave si legge da `ProcessInfo.processInfo.environment` limitata a `XAI_API_KEY` e `GROK_CODE_XAI_API_KEY`.
- `GrokPlanGuard`: funzione pura `(interactionMode, payload) -> HookResponse` con `deny` sui tool fuori dall'insieme read-only. L'insieme diventa un `Set<String>` costante. `sessionMeta` è un `[String: JSONValue]` costruito una volta e reinviato su ogni load/resume.
- `GrokExtensionHandlers` con tre gruppi: hook, domande, exit plan. Le domande diventano `AsyncStream` di `UserInputRequest` più una `CheckedContinuation` per la risposta; le chiavi della risposta sono il testo della domanda. L'exit plan produce un evento `turnProposedCompleted(planMarkdown:)` e una cancellazione semantica con il feedback fisso; il ritardo di 25 ms prima di chiudere il turno Plan va conservato, perché serve a far arrivare la risposta dell'estensione prima della cancellazione locale.
- `actor GrokSession` con lo stesso stato di `GrokSessionContext` ridotto all'essenziale: `activeTurnId`, `activeInteractionMode`, `lastPlanFingerprint`, `lastTurnActivityAt`, `turnToolCallIds: [String: TurnId]`, `latestSessionCostUsd`, `compacting`, `stopped`. Un `threadLock` per thread va reso come `actor ThreadLock` con una coda seriale per id, equivalente al `Semaphore` per thread di Synara.
- Eventi come `enum GrokEvent` conforme all'enum normalizzato di Trama, così `TurnId` resta locale: gli id di item e tool call vengono prefissati con `"grok:\(turnId):"` e l'id nativo del provider viene conservato in `providerToolCallId`. Una funzione pura `scopeItemId(turnId:itemId:)` copre il caso delle sessioni riprese.
- Watchdog come `struct TurnIdleWatchdog` con un `Clock` iniettato: soglia 600 s, intervallo 15 s, override da variabile d'ambiente ignorando valori non positivi, pausa quando c'è un'approvazione o un input umano in sospeso, e solo i tag di progresso (`contentDelta`, `toolCall`, `plan`, segmenti assistente) rinnovano il clock.
- Costi e token: `latestSessionCostUsd` accetta solo USD finiti non negativi; ogni esito di turno porta `cumulativeCostUsd` se noto. L'uso di `PromptResponse.usage` resta la spesa cumulativa e non va convertito in occupazione del contesto: il misuratore di contesto si aggiorna solo dalla notifica `usage_update`.
- Modello ed effort come `struct GrokModelOptions { var reasoningEffort: GrokReasoningEffort? }` normalizzato contro le capacità della famiglia del modello (build / 4.5 / 4.6), con default escluso. Poiché `session/set_config_option` non è supportato, il cambio modello dichiara `restart-session` e il runtime riparte con nuovi argomenti e `resumeSessionId`.
- Catalogo: `GrokModelCatalog` con due sorgenti (output di `grok models`, endpoint `language-models`) e la regola "la CLI vince, l'API è il fallback"; deduplica per slug in minuscolo; il formatter dei nomi mappa i due casi speciali e delega al resto.
- Fork: se c'è un turno in volo o manca il cursore, errore di validazione che invita al fork da trascrizione; altrimenti attendere il gate di replay e chiamare `session/fork` con `cwd` di destinazione e nessun server MCP. Restituire solo il cursore.

### Da non portare

- Effect-TS in ogni forma: `Layer`, `Scope`, `Deferred`, `Fiber`, `PubSub`, `SynchronizedRef`, `Semaphore`, `Cause`, `Exit`, `Stream`. In Swift bastano actor, `Task` e continuation.
- `ChildProcessSpawner` di Effect e `makeEffectProcessCommand`: in Swift si usa `Process` con tre pipe.
- `buildProviderChildEnvironment` con l'allowlist delle chiavi credenziali: è una difesa del processo Node che spawna figli; in Trama il processo figlio eredita l'ambiente controllato dal runtime Swift.
- La lettura di `process.env` a runtime per chiave e variabili di debug (`SYNARA_GROK_ACP_DEBUG`, `DP_GROK_ACP_DEBUG`, `SYNARA_GROK_TURN_IDLE_TIMEOUT_MS`): in Trama la configurazione arriva dal documento di progetto e dal pannello impostazioni, non da variabili d'ambiente. Al massimo si tengono due costanti con override esplicito in sviluppo.
- I logger NDJSON nativi e i logger di debug ACP (`makeAcpNativeLoggers`, `makeAcpDebugLoggers`, marker `grok-acp-meta-stripper-v2`): in Trama i log vanno nel sistema di log dell'app.
- La policy outbound HTTP con `requirePublicAddress`, `maxRedirects`, `maxQueued` e contatori di byte: è una difesa del server Synara che parla con la rete; la scoperta via API xAI in Trama può essere omessa del tutto se il catalogo CLI basta.
- Il percorso con quattro sorgenti di verità del catalogo statico (`MODEL_OPTIONS_BY_PROVIDER`, `MODEL_CAPABILITIES_INDEX`, alias, `resolveGrokEffortFamily`): in Trama il catalogo è dato dal provider e le capacità si ricavano dalla famiglia con una sola funzione.
- La logica di compact (`compactingThread`, `compactionQuietUntil`, `compactionCancelFiber`, `settleGrokCompactionOutcome`, i due tempi di quiete): è una compensazione per un RPC di manutenzione su stdio con figlio che può diventare sordo. Se in Trama il compact non c'è nel primo giro, questa macchina non va portata.
- L'adattamento del percorso WSL e i test seam `__testTransitionReached`: già dichiarati non portabili nella ricerca ACP.
- Il provider Grok non è nella lista `GIT_TEXT_GENERATION_PROVIDERS` (`packages/contracts/src/model.ts`), quindi non va esposto come generatore di testo git.

### Non trovato

- Un server MCP locale dedicato a Grok: l'iniezione passa interamente da `buildAcpSynaraMcpServers`, quindi dal proxy stdio/HTTP del gateway. Cercato leggendo `mcpInjection.ts` per intero e le chiamate `buildMcpServers` in `GrokAdapter.ts`.
- Un metodo ACP `session/set_model` o `session/set_config_option` usato per Grok: `applyGrokAcpModelSelection` è un no-op dichiarato (`GrokAcpSupport.ts:216-231`) e il test lo conferma. Cercato leggendo tutta `GrokAcpSupport.ts` e `GrokAdapter.ts`.
- Una gestione Grok di `handleElicitation`, `handleExtNotification`, `handleReadTextFile`, `handleWriteTextFile`, `handleCreateTerminal`: non compaiono in `GrokAdapter.ts`. Cercato leggendo i registri in `startSession` (`GrokAdapter.ts:1100-1300`).
- Un test Grok-specifico dentro `ProviderHealth.test.ts`: ho verificato solo gli import (`ProviderHealth.test.ts:27-31`) e le funzioni di produzione. Non ho potuto elencare le directory con lo strumento read, quindi non ho fatto un grep esaustivo su tutti i file di test del repository.
- Il valore esatto e la semantica degli argomenti ACP oltre `stdio`: non cercati, appartengono alla CLI Grok e non al codice di Synara.
- Un comando/sottocomando Synara per aggiornare la CLI Grok: Grok non compare in `PACKAGE_MANAGED_PROVIDER_UPDATES` (`ProviderHealth.ts:151-256`). Non ho verificato se esista un altro percorso di aggiornamento fuori da quel file.