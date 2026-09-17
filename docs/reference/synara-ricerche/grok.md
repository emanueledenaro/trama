## NN. Provider Grok

Ticket: P04. Grok Build è la CLI di xAI; Synara la avvia come `grok --permission-mode default agent --no-leader ... stdio` e ci parla in ACP su stdio (`apps/server/src/provider/acp/GrokAcpSupport.ts:100-130`). Il runtime generico è descritto nella sezione Runtime ACP condiviso; qui c'è solo ciò che è proprio di Grok. Tutti i percorsi sono relativi alla radice di Synara.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Layers/GrokAdapter.ts` | adattatore completo (sessioni, turni, eventi, compattazione, modelli), 2629 righe |
| `apps/server/src/provider/Services/GrokAdapter.ts` | interfaccia del servizio, `provider: "grok"` (righe 11-17) |
| `apps/server/src/provider/acp/GrokAcpSupport.ts` | comando, autenticazione, ripetizione della sessione nuova, comando `/compact` |
| `apps/server/src/provider/acp/GrokAcpExtension.ts` | codec e proiezione dei metodi `x.ai/*` |
| `apps/server/src/provider/Layers/ProviderHealth.ts:1193-1267` | stato di accesso |
| `apps/server/src/agentGateway/mcpInjection.ts:264-291` | voci `mcpServers` per ACP |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `settings.ts` | opzioni, selezione, impostazioni |

Test: `Layers/GrokAdapter.test.ts` (416 righe), `acp/GrokAcpSupport.test.ts` (390 righe), sotto `apps/server/src/provider/`. Non esiste un `GrokAcpExtension.test.ts`: le funzioni dell'estensione sono provate da `GrokAdapter.test.ts`.

### Trasporto

- Eseguibile: `binaryPath` configurato se non vuoto, altrimenti `grok` (`apps/server/src/provider/acp/GrokAcpSupport.ts:125`). Il predefinito nelle impostazioni è `grok` (`packages/contracts/src/settings.ts:39-43`).
- Argomenti, in quest'ordine: `--permission-mode default`, `agent`, `--no-leader`, poi `--always-approve` solo in `full-access`, poi `-m <modello>`, poi `--reasoning-effort <sforzo>`, infine `stdio` (`apps/server/src/provider/acp/GrokAcpSupport.ts:110-122`). Il commento spiega la scelta: la modalità per richiesta resta la base, ma alcune build di Grok negano prima di emettere la richiesta di permesso, quindi Full Access ha bisogno anche dell'override di processo (`:105-109`).
- Cambiare modalità di runtime, modello o sforzo vuol dire riavviare il processo: sono impostazioni di avvio, non config option ACP (`apps/server/src/provider/acp/GrokAcpSupport.ts:226-229`).
- Ambiente: quello filtrato per il provider `grok`, che lascia passare solo `XAI_API_KEY` e `GROK_CODE_XAI_API_KEY` (`apps/server/src/provider/acp/GrokAcpSupport.ts:128`; `apps/server/src/providerChildEnvironment.ts:62`).
- Il client dichiara solo `clientInfo` `Synara` (`apps/server/src/provider/Layers/GrokAdapter.ts:1077`); non passa `clientCapabilities` proprie. I ganci lato client si registrano invece dal `_meta` del setup di sessione, ripetuto anche su load e resume (`apps/server/src/provider/Layers/GrokAdapter.ts:1078-1081`).
- `freshSessionRetry`: se `session/new` fallisce con `data.code === "FS_NOT_FOUND"`, la richiesta si ripete una volta dopo 100 ms (`apps/server/src/provider/acp/GrokAcpSupport.ts:46-54`, `:203-206`).

Tempi propri di Grok:

| Costante | Valore | Riga |
| --- | --- | --- |
| fork e resume per il fork | 30 s | `apps/server/src/provider/Layers/GrokAdapter.ts:153` |
| scoperta modelli | 15 s | `apps/server/src/provider/Layers/GrokAdapter.ts:150` |
| chiamata HTTP a xAI | 10 s | `apps/server/src/provider/Layers/GrokAdapter.ts:623` |
| turno senza attività | 600 s, `SYNARA_GROK_TURN_IDLE_TIMEOUT_MS` | `apps/server/src/provider/Layers/GrokAdapter.ts:163-166` |
| controllo del watchdog | 15 s | `apps/server/src/provider/Layers/GrokAdapter.ts:167` |
| `/compact` | come il turno, 600 s | `apps/server/src/provider/Layers/GrokAdapter.ts:172` |
| quiete dopo un `/compact` abbandonato | 5 s | `apps/server/src/provider/Layers/GrokAdapter.ts:177` |
| attesa dell'annullamento dopo il timeout | 10 s | `apps/server/src/provider/Layers/GrokAdapter.ts:182` |
| quiete per decidere l'esito di `/compact` | 200 ms, tetto 2 s | `apps/server/src/provider/Layers/GrokAdapter.ts:186-187` |
| svuotamento eventi a fine turno | max 1 s, passo 25 ms | `apps/server/src/provider/Layers/GrokAdapter.ts:193-194` |
| grazia prima di chiudere un turno Plan | 25 ms | `apps/server/src/provider/Layers/GrokAdapter.ts:195` |

Grok non passa `startupTimeouts`: valgono i valori del runtime condiviso.

### Controllo di accesso

Autenticazione ACP: `resolveGrokAcpAuthMethodId` guarda i metodi annunciati da `initialize` (`apps/server/src/provider/acp/GrokAcpSupport.ts:144-191`). Con una chiave in `XAI_API_KEY` o `GROK_CODE_XAI_API_KEY` (`:43`, `:56-68`) e il metodo `xai.api_key` annunciato, usa quello; altrimenti `cached_token` se c'è; altrimenti fallisce con `-32602` e un messaggio diverso per ogni caso:

| Situazione | `reason` | Messaggio |
| --- | --- | --- |
| `xai.api_key` annunciato ma nessuna chiave | `credentials_missing` | "Grok ACP requires API-key authentication, but XAI_API_KEY is not set..." (`:157-164`) |
| solo metodi interattivi (`browser_login`, `grok.com`) e nessuna chiave | `credentials_missing` | "Grok is not authenticated for headless ACP. Run \`grok login\`..." (`:42`, `:165-175`) |
| chiave presente ma `xai.api_key` non annunciato | `compatibility_mismatch` | "Grok did not advertise API-key authentication even though XAI_API_KEY is set..." (`:176-182`) |
| nessun metodo supportato o elenco vuoto | `compatibility_mismatch` | "Grok ACP advertised no supported headless authentication method..." (`:183-190`) |

La richiesta `authenticate` porta `_meta: { headless: true }` (`apps/server/src/provider/acp/GrokAcpSupport.ts:202`).

Stato mostrato: `makeCheckGrokProviderStatus` (`apps/server/src/provider/Layers/ProviderHealth.ts:1195-1265`) esegue solo `grok --version` con timeout `DEFAULT_TIMEOUT_MS` di 4 s (`:115`, `:673-681`, `:1201-1204`). Non c'è un comando di login da interrogare.

| Esito di `--version` | status | available | authStatus | Messaggio |
| --- | --- | --- | --- | --- |
| eseguibile assente | `error` | false | `unknown` | "Grok CLI (`grok`) is not installed or not on PATH." (`:1206-1219`) |
| errore di avvio | `error` | false | `unknown` | "Failed to execute Grok CLI health check: ..." (`:1217-1218`) |
| timeout | `error` | false | `unknown` | "Grok CLI is installed but failed to run. Timed out while running command." (`:1221-1231`) |
| uscita non zero | `error` | false | `unknown` | "...failed to run." più il dettaglio (`:1233-1246`) |
| successo con chiave xAI | `ready` | true | `authenticated` | `authType: "apiKey"`, `authLabel: "xAI API Key"` (`:1248-1259`) |
| successo senza chiave | `ready` | true | `unknown` | "Grok CLI is installed. Run `grok` to authenticate locally, or set XAI_API_KEY before starting a session." (`:1260-1263`) |

La versione si legge con `parseGenericCliVersion` da stdout e stderr (`apps/server/src/provider/Layers/ProviderHealth.ts:1247`). Grok non compare in `PACKAGE_MANAGED_PROVIDER_UPDATES` (`apps/server/src/provider/Layers/ProviderHealth.ts:189-275`), quindi non ha aggiornamento gestito.

### Catalogo modelli

- Fonte principale: `grok models` lanciato come processo figlio con l'ambiente filtrato (`apps/server/src/provider/Layers/GrokAdapter.ts:2397-2421`). `parseGrokCliModelList` legge la riga `Default model: X`, poi tutto ciò che segue `Available models:`, con `[*-]` opzionale e un `(...)` che può contenere "default"; la prima riga vuota dopo almeno un modello chiude l'elenco; se non trova nulla usa il modello predefinito come unica voce; l'elenco viene ordinato mettendo il predefinito davanti (`:473-525`).
- Seconda fonte: l'API xAI `GET <base>/language-models` con `Authorization: Bearer <chiave>`, usata solo se una chiave è presente (`apps/server/src/provider/Layers/GrokAdapter.ts:611-654`, `:2430-2440`). La base è `https://api.x.ai/v1`, sovrascrivibile con `XAI_API_BASE_URL` (`:196`, `:607-609`). La politica di rete impone origine consentita, indirizzo pubblico, nessun redirect e massimo 1 MB di risposta (`:620-630`).
- `parseXaiLanguageModelDescriptors` tiene solo gli slug `grok-build-0.1` e `grok-code-fast*`, alias compresi, saltando voci non oggetto, senza `id` stringa, con id vuoto o già viste (`apps/server/src/provider/Layers/GrokAdapter.ts:458-471`, `:527-560`).
- Precedenza: se la CLI ha risposto vince la CLI, perché l'API xAI annuncia ancora slug ritirati; l'API serve solo come ripiego (`apps/server/src/provider/Layers/GrokAdapter.ts:562-575`).
- `mergeGrokModelDescriptors` deduplica per slug in minuscolo e prende gli sforzi dal catalogo statico dei contratti con `getModelCapabilities("grok", slug)` (`apps/server/src/provider/Layers/GrokAdapter.ts:577-605`). I nomi passano da `formatGrokModelName`: `grok-build-0.1` diventa "Grok Build 0.1", `grok-build` diventa "Grok 4.3", il resto passa da `humanizeModelSlug` (`:448-456`).
- Esito: `source` `"grok-cli"` se la CLI ha dato qualcosa, altrimenti `"grok-cli+xai-api"`, sempre `cached: false` (`apps/server/src/provider/Layers/GrokAdapter.ts:2457-2461`). Nessuna cache. Con zero modelli si rilancia l'errore della CLI, poi quello dell'API, altrimenti "Grok model discovery returned no models." (`:2444-2456`). Timeout totale 15 s con "Timed out while discovering Grok models via CLI." (`:2465-2478`).
- Catalogo statico nei contratti: una sola voce, `grok-4.6` (`packages/contracts/src/model.ts:695-701`), predefinito `grok-4.6` (`packages/contracts/src/model.ts:1144`), alias di migrazione (`packages/contracts/src/model.ts:1288-1300`). Le scale di sforzo sono tre: `grok-build` con `none/low/medium/high` e predefinito `low`, `grok-4.5` con `low/medium/high` e predefinito `high`, `grok-4.6` che aggiunge `xhigh` (`packages/contracts/src/model.ts:283-301`).

### Opzioni

- `GrokModelOptions` ha solo `reasoningEffort`, ristretto a `none`, `low`, `medium`, `high`, `xhigh` (`packages/contracts/src/model.ts:32-33`, `:140-143`). Selezione `GrokModelSelection` con `provider: "grok"` (`packages/contracts/src/orchestration.ts:141-146`); opzioni di avvio solo `binaryPath` (`packages/contracts/src/orchestration.ts:209-211`).
- `resolveGrokRuntimeModelSettings` passa modello e sforzo al comando, dopo `normalizeGrokModelOptions`, che scarta uno sforzo non supportato dal modello e anche quello uguale al predefinito (`apps/server/src/provider/Layers/GrokAdapter.ts:678-692`; `packages/shared/src/model.ts:897-910`).
- `applyGrokAcpModelSelection` non fa nulla: Grok ACP 0.1.210 annuncia i modelli ma non implementa `session/set_config_option` (`apps/server/src/provider/acp/GrokAcpSupport.ts:216-229`). L'adattatore la chiama comunque all'avvio e a ogni turno, per tenere un solo punto di applicazione (`apps/server/src/provider/Layers/GrokAdapter.ts:656-676`, `:1608-1613`, `:1782-1793`).
- Modalità per turno: `session/prompt` porta `_meta.mode` uguale a `plan` o `agent`, scelta idempotente preferita a `x.ai/toggle_plan_mode` perché un riaggancio non può invertire lo stato del provider (`apps/server/src/provider/Layers/GrokAdapter.ts:255-262`).
- In Plan il testo riceve il prefisso `GROK_PLAN_MODE_PROMPT_PREFIX` tramite `withAcpPlanModePrompt` (`apps/server/src/provider/Layers/GrokAdapter.ts:197-202`, `:241-253`).
- Guardia Plan: il `_meta` di sessione registra un gancio `PreToolUse` con matcher `*` e id `synara-plan-guard` (`apps/server/src/provider/Layers/GrokAdapter.ts:229-239`). La richiesta `x.ai/hooks/run` passa per `resolveGrokPlanHookResponse`: fuori da Plan, con payload non oggetto, con id di callback diverso o con evento diverso da `pre_tool_use` risponde `{}`; se lo strumento è in una lista bianca di 24 nomi di sola lettura risponde `{}`; altrimenti nega con un messaggio di sistema (`:203-228`, `:276-300`, `:1101-1103`).

### Capacità dichiarate

Oggetto `capabilities` (`apps/server/src/provider/Layers/GrokAdapter.ts:2599-2601`):

```ts
{ sessionModelSwitch: "restart-session" }
```

`getComposerCapabilities` (`apps/server/src/provider/Layers/GrokAdapter.ts:2174-2185`): `supportsSkillMentions: false`, `supportsSkillDiscovery: false`, `supportsNativeSlashCommandDiscovery: false`, `supportsPluginMentions: false`, `supportsPluginDiscovery: false`, `supportsRuntimeModelList: true`, `supportsThreadCompaction: true`, `supportsThreadImport: false`. Metodi esposti: `forkThread`, `respondToUserInput`, `compactThread`, `listModels`; mancano `listSkills`, `listCommands`, `listPlugins`, `readExternalThread` (`apps/server/src/provider/Layers/GrokAdapter.ts:2597-2618`).

### Ciclo di vita e cursore di ripresa

- Cursore: `{ schemaVersion: 1, sessionId }`; si scarta se la versione è diversa o l'id è vuoto (`apps/server/src/provider/Layers/GrokAdapter.ts:149`, `:441-446`, `:1292-1295`).
- Avvio sotto blocco per thread: valida il provider, risolve la cartella, ferma la sessione precedente, registra i gestori (`x.ai/hooks/run`, le due grafie di `ask_user_question`, le due di `exit_plan_mode`, `session/request_permission`), poi `acp.start()` (`apps/server/src/provider/Layers/GrokAdapter.ts:985-1280`). Un log `grok.acp.start` riassume cartella, ripresa, modello, sforzo e `--always-approve` (`:1059-1069`).
- L'attesa di `awaitLoadReplayReady` gira senza il blocco; poi, sotto blocco, si risolve `sessionConfigReady` e si emettono `session.started`, `session.state.changed` `ready` e `thread.started` (`apps/server/src/provider/Layers/GrokAdapter.ts:1583-1641`).
- Turno: `sendTurn` rifiuta se una compattazione è in corso o se un altro turno sta partendo, poi alza `turnStarting` e azzera `pendingTurnInterrupted` (`apps/server/src/provider/Layers/GrokAdapter.ts:1706-1742`). `startGrokTurn` attende la configurazione, la quiete di una compattazione abbandonata e il gate di replay, ricontrolla `stopped` prima e dopo la lettura degli allegati, e solo allora assegna `activeTurnId` (`:1744-1874`).
- Prima di mandare il prompt, una `Effect.suspend` ricontrolla `pendingTurnInterrupted` e `stopped`: un turno annullato non viene mai inviato e si chiude per la via `cancelled` (`apps/server/src/provider/Layers/GrokAdapter.ts:1876-1889`, `:2008-2034`).
- Prima di chiudere un turno, riuscito o fallito, si attende lo svuotamento della coda di eventi, così gli aggiornamenti tardivi restano attribuiti al turno (`apps/server/src/provider/Layers/GrokAdapter.ts:914-920`, `:1896`, `:1932`).
- Watchdog: `forkAcpAdapterTurnIdleWatchdog`, con l'orologio aggiornato solo dagli eventi di progresso (`apps/server/src/provider/Layers/GrokAdapter.ts:1338-1340`, `:2044-2050`). Allo scadere emette `turn.completed` `failed` con "Grok stopped responding (no activity for Ns); the turn was timed out.", logga `grok.acp.turn_idle_timeout` e manda `session/cancel` in una fibra separata, per non restare appeso su un figlio muto (`:1657-1704`).
- Interruzione: un `turnId` vecchio viene ignorato con `grok.acp.stale_interrupt_ignored`; se il turno sta ancora partendo e non c'è fibra, alza `pendingTurnInterrupted` (`apps/server/src/provider/Layers/GrokAdapter.ts:2059-2096`).
- Piano: la richiesta `x.ai/exit_plan_mode` (o `_x.ai/exit_plan_mode`) diventa `turn.proposed.completed`; Synara risponde `cancelled` con un messaggio che tiene chiusa la porta nativa di Grok, e chiude il turno dopo 25 ms perché la risposta arrivi prima dell'annullamento (`apps/server/src/provider/acp/GrokAcpExtension.ts:79-114`; `apps/server/src/provider/Layers/GrokAdapter.ts:1141-1192`). Un turno in modalità `default` risponde invece `approved`: è l'approvazione implicita dell'utente (`:1145-1149`). Se Grok non manda l'estensione, il testo finale del turno Plan diventa comunque una proposta (`:264-274`, `:1939-1959`).
- Compattazione: `compactThread` attende la configurazione, prende lo slot sotto blocco e poi esegue il prompt fuori dal blocco, così una compattazione appesa non impedisce lo stop (`apps/server/src/provider/Layers/GrokAdapter.ts:2187-2249`). `runGrokAcpCompactionCommand` manda `/compact` con `_meta: { mode: "agent" }`, e se l'agente annuncia comandi senza `compact` fallisce con `-32601` e l'invito ad aggiornare (`apps/server/src/provider/acp/GrokAcpSupport.ts:70-98`). Gli esiti: interruzione lasciata passare, sessione ferma trattata come interruzione, timeout con annullamento forkato e quiete di 5 s, `stopReason` `cancelled`, strumento di compattazione fallito, e infine il successo che pubblica solo `thread.state.changed` `compacted` (`apps/server/src/provider/Layers/GrokAdapter.ts:2251-2390`).
- Rollback: taglia gli ultimi N turni ritenuti in memoria (`apps/server/src/provider/Layers/GrokAdapter.ts:2140-2153`). Fork: `session/fork` sulla sessione attiva o su una ripresa temporanea che riceve di nuovo `GROK_SESSION_META`; rifiutato con un turno in corso; restituisce solo il nuovo cursore (`:2489-2584`).

### Iniezione degli strumenti host

- Con credenziali del gateway l'adattatore prende una lease per thread e passa `buildMcpServers` al runtime (`apps/server/src/provider/Layers/GrokAdapter.ts:1017-1021`, `:1082-1091`). Il runtime la chiama dopo `initialize` e mette il risultato in `session/new`, `session/resume` o `session/load` (`apps/server/src/provider/acp/AcpSessionRuntime.ts:1788`, `:1873`, `:1900`, `:1927`).
- `buildAcpSynaraMcpServers`: voce HTTP `synara` con header `Authorization: Bearer <token>` se `agentCapabilities.mcpCapabilities.http` è vero, altrimenti voce stdio con il proxy e le variabili `SYNARA_AGENT_GATEWAY_URL` e `SYNARA_AGENT_GATEWAY_TOKEN` (`apps/server/src/agentGateway/mcpInjection.ts:264-291`).
- La lease si rilascia allo stop e all'uscita del processo; ogni fine turno annulla le richieste del gateway per quel turno (`apps/server/src/provider/Layers/GrokAdapter.ts:810-811`, `:1281`, `:1900`, `:1938`, `:2077-2079`).
- La politica host di Synara si antepone una sola volta al primo prompt (`apps/server/src/provider/Layers/GrokAdapter.ts:141-148`, `:1827-1833`).

### Eventi d'uso

- `UsageUpdated` registra il costo con `recordAcpSessionCost` e pubblica l'evento di uso token solo con un turno attivo (`apps/server/src/provider/Layers/GrokAdapter.ts:1536-1556`).
- `turn.completed` porta `result.usage` se presente e il costo del turno, ma non sintetizza un aggiornamento di finestra di contesto da quel dato: `PromptResponse.usage` è spesa cumulativa, e usarla farebbe crescere il misuratore a ogni turno e lo terrebbe pieno dopo una compattazione (`apps/server/src/provider/Layers/GrokAdapter.ts:1984-2005`).
- Attribuzione degli eventi: `turnToolCallIds` lega ogni id di strumento al turno che lo ha aperto, così un aggiornamento in coda che arriva dopo la chiusura del turno finisce ancora sul turno giusto e non viene scambiato per compattazione automatica (`apps/server/src/provider/Layers/GrokAdapter.ts:1409-1416`, `:1461-1478`).
- Compattazione nella UI: gli aggiornamenti riconosciuti come compattazione (`compact` o `summariz` in kind, titolo o dettaglio) diventano righe `context_compaction` con un id fisso per thread; durante un `/compact` manuale restano solo di progresso, perché la riga terminale la emette `compactThread` (`apps/server/src/provider/Layers/GrokAdapter.ts:409-415`, `:889-912`, `:1421-1459`).
- I messaggi assistente vuoti non producono un `item.completed`: serve almeno una delta visibile, cioè testo non vuoto e non `reasoning_text` (`apps/server/src/provider/Layers/GrokAdapter.ts:426-431`, `:1353-1384`, `:1512-1520`).
- Un turno che finisce senza contenuto e senza `cancelled` logga `grok.acp.turn_completed_without_content` (`apps/server/src/provider/Layers/GrokAdapter.ts:1972-1979`).

### Casi limite dai test

- `apps/server/src/provider/Layers/GrokAdapter.test.ts:39` (keeps only reasoning efforts supported by the selected model family)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:62` (delivers private scoped host context once)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:72` (adds Plan instructions without sending a pager-only slash command as model text)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:81` (sets Grok's native prompt mode idempotently on every turn)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:87` (backs native Plan mode with a fail-closed pre-tool hook)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:125` (leaves Default prompts untouched after the native gate is switched explicitly)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:134` (uses Grok agent mode for Debug prompts)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:143` (accepts current and legacy ACP method names)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:157` (does not invent a plan when Grok submits an empty plan file)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:167` (keeps native plan mode gated after Synara captures the plan)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:175` (approves leaving native plan mode only for a later implementation turn)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:179` (uses a terminal Plan response as a proposal when Grok omits the extension)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:215` (accepts current and legacy question method names)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:222` (maps Synara answers to Grok's question-text keyed response)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:243` (makes reused ACP assistant segment ids unique per DP turn)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:254` (preserves the provider tool id while scoping the runtime item id)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:272` (detects Grok compaction tool calls for context compaction UI rows)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:293` (only treats visible assistant text as renderable Grok content)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:314` (parses xAI language model API responses for picker discovery)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:337` (merges Grok CLI and xAI API model lists without duplicates)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:369` (humanizes an unknown future Grok family through the shared formatter)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:374` (keeps the live Grok CLI catalog instead of retired xAI API slugs)
- `apps/server/src/provider/Layers/GrokAdapter.test.ts:390` (stamps Grok 4.6 with Extra High instead of the grok-build None ladder)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:23` (builds the default Grok ACP command)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:45` (passes model and reasoning effort without process-wide approval overrides)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:74` (passes Grok 4.6 extra-high reasoning effort to the CLI)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:98` (uses Grok's process-scoped approval override only for Full Access)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:111` (matches Grok's stable persistence code)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:123` (does not retry other ACP or filesystem failures)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:171` (still accepts the legacy Grok API key env var)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:193` (identifies an interactive-only advertisement as missing headless credentials)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:217` (distinguishes an API-key advertisement mismatch from missing credentials)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:228` (reports unknown or empty auth advertisements as a compatibility mismatch)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:260` (auto-allows Full Access requests with the provider's request-scoped option)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:270` (keeps Plan mode fail-closed above Full Access)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:282` (does not call Grok's unsupported ACP config-option method)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:325` (runs Grok's advertised /compact command explicitly in agent mode)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:352` (keeps /compact compatible when an older Grok ACP advertises no commands)
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts:368` (fails clearly when Grok advertises commands without /compact)

### In Trama

Grok diventa un profilo del client ACP condiviso, senza un secondo runtime:

```swift
struct GrokACPProfile: ACPProviderProfile {
    let kind: ProviderKind = .grok
    func spawn(settings: GrokSettings, cwd: URL, runtimeMode: RuntimeMode) -> ACPSpawn  // --permission-mode default agent --no-leader [--always-approve] [-m] [--reasoning-effort] stdio
    func authMethod(for initialize: ACPInitializeResult, env: Environment) throws -> String // xai.api_key, poi cached_token
    var authenticateMeta: [String: JSONValue] { ["headless": true] }
    var sessionMeta: JSONObject? { GrokSessionMeta.planGuardHook }
    var freshSessionRetry: ACPFreshSessionRetry? { .init(delay: .milliseconds(100)) { $0.dataCode == "FS_NOT_FOUND" } }
    func mcpServers(initialize: ACPInitializeResult, lease: GatewayLease) -> [ACPMcpServer]
    func register(on: ACPConnection) async  // x.ai/hooks/run, ask_user_question, exit_plan_mode
}
```

- Modello e sforzo non sono scritture in sessione: `GrokAdapter` li mette negli argomenti e, se cambiano, riavvia il processo. In Swift resta un solo punto, `spawn`, e `capabilities.sessionModelSwitch = .restartSession`.
- La guardia Plan è una funzione pura: `func planHookDecision(mode: InteractionMode?, payload: JSONValue) -> GrokHookDecision`, con la lista bianca dei 24 strumenti come `Set<String>` statico. Si prova senza processo, come fa `GrokAdapter.test.ts:87`.
- `GrokAdapter` è un attore che tiene per thread `GrokSessionContext`: turno attivo, `turnToolCallIds`, `activeAssistantItemsWithContent`, contatore degli eventi elaborati, `turnStarting` e `pendingTurnInterrupted` come flag letti e scritti dentro l'attore, quindi senza corse.
- La compattazione diventa `func compact() async throws` con `withThrowingTaskGroup` e `Task.sleep` per le finestre di quiete; il `Task` di annullamento dopo un timeout si conserva e si attende con un tetto, come oggi.
- Scoperta modelli: `GrokModelDiscovery` prova `grok models` e, se c'è una chiave, l'API xAI con `URLSession`; la CLI vince. Il parser della CLI e quello del JSON sono funzioni pure provate con gli stessi campioni dei test.
- Stato di accesso: solo `grok --version` con timeout 4 s, più la presenza della chiave per distinguere `authenticated` da `unknown`.

### Da non portare

- Le variabili di debug `SYNARA_GROK_ACP_DEBUG` e l'eredità `DP_GROK_ACP_DEBUG`, con il marcatore di trasporto e i log di eventi soppressi (`apps/server/src/provider/Layers/GrokAdapter.ts:154-158`, `:309-315`, `:864-875`, `:1038-1046`).
- Il logger NDJSON nativo e il mirroring dei payload che contengono `grokShell` o `x.ai/fs_notify` (`apps/server/src/provider/Layers/GrokAdapter.ts:745-764`, `:1044-1045`).
- La meccanica Effect di fibre, scope, `Deferred` e `Effect.forkIn` (`apps/server/src/provider/Layers/GrokAdapter.ts:1572`, `:2037`): in Swift diventa concorrenza strutturata.
- I codec `Schema` di `GrokAcpExtension.ts:9-29` e `:81-85`: in Swift bastano tipi `Codable`.
- `applyGrokAcpModelSelection` e il suo involucro, che oggi non fanno nulla (`apps/server/src/provider/acp/GrokAcpSupport.ts:216-229`; `apps/server/src/provider/Layers/GrokAdapter.ts:656-676`).
- La politica di rete `outboundHttp` con code e limiti di concorrenza (`apps/server/src/provider/Layers/GrokAdapter.ts:618-635`): in Swift basta `URLSession` con timeout.

### Non trovato

- Una cache dei modelli Grok: `listModels` restituisce sempre `cached: false` e non c'è mappa di cache. Cercati `cache`, `Cache` e `ttl` in `GrokAdapter.ts`.
- Un comando di login o di stato account per Grok: il controllo usa solo `--version` e la variabile d'ambiente, quindi `authStatus: "unauthenticated"` non viene mai prodotto. Cercati `login`, `auth` e `whoami` in `ProviderHealth.ts`.
- Un aggiornamento gestito per Grok: nessuna voce `grok` in `PACKAGE_MANAGED_PROVIDER_UPDATES` (`apps/server/src/provider/Layers/ProviderHealth.ts:189-275`) e nessun ramo dedicato in `getProviderMaintenanceCapabilities` (`:2158-2199`).
- Un file di test per `GrokAcpExtension.ts`: non esiste; le sue funzioni sono provate da `GrokAdapter.test.ts:143-240`.
- Una sonda facoltativa contro una CLI Grok reale, come `CursorAcpCliProbe.test.ts`: non esiste per Grok.
- Scoperta di skill, comandi slash o plugin per Grok: tutte le capacità sono `false` e non ci sono metodi corrispondenti.
- Un `startupTimeouts` proprio di Grok o un `validateInitializeResult`: cercati entrambi in `GrokAdapter.ts` e `GrokAcpSupport.ts`, nessun risultato.
