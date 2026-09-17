## NN. Provider Codex

Ticket: V08, V02.

Codex è l'adattatore che parla con il processo `codex app-server` via JSON-RPC su stdio. La sezione 5 descrive già la forma comune dell'adattatore, la tabella degli eventi e il ciclo di vita di base; qui c'è quello che manca, riletto al commit `9f91d59`.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Services/CodexAdapter.ts` | Tag del servizio, `provider: "codex"` (`:21-30`) |
| `apps/server/src/provider/Layers/CodexAdapter.ts` | Adattatore: mappatura eventi, watchdog, capacità (`:1877-2503`) |
| `apps/server/src/codexAppServerManager.ts` | Processi, JSON-RPC, sessioni, scoperta, controllo di versione |
| `apps/server/src/codexAppServerTransport.ts` | Framing JSONL e coda di scrittura su stdin |
| `apps/server/src/codexProcessEnv.ts`, `codexHomePaths.ts` | Ambiente del processo e `CODEX_HOME` sovrapposta |
| `apps/server/src/codexTurnInput.ts`, `codexServiceTier.ts`, `codexErrorClassification.ts`, `codexWorkingDirectory.ts` | Piccoli aiutanti puri |
| `apps/server/src/provider/codexDiscoveryCatalog.ts`, `codexCliVersion.ts` | Parsing di `model/list`, skill, plugin; versioni minime |
| `apps/server/src/agentGateway/mcpInjection.ts` | Blocco TOML del server MCP `synara` |
| `apps/server/src/provider/Layers/ProviderHealth.ts` | Controllo di accesso Codex (`:797-995`) |
| `packages/contracts/src/model.ts`, `orchestration.ts` | Opzioni, catalogo statico, `CodexProviderStartOptions` |

### Trasporto

- Avvio: `spawnProcess(binaryPath, ["app-server"], { cwd, env, stdio: pipe })` (`apps/server/src/codexAppServerManager.ts:776-787`). Il binario è `providerOptions.codex.binaryPath` o `"codex"` (`codexAppServerManager.ts:1148-1150`, `:4233-4245`).
- Stdout: framing a byte con limite di 16 MiB per riga; il `\r` finale si toglie; UTF-8 non valido, riga troppo lunga o riga non terminata a fine flusso sono errori tipati (`apps/server/src/codexAppServerTransport.ts:3`, `:6-12`, `:36-134`, `:120`).
- Stdin: scritture serializzate, una alla volta, con attesa di `drain` e coda massima di 32 MiB; oltre si rifiuta con `write-overloaded` (`codexAppServerTransport.ts:4`, `:143-255`).
- Righe di stdout che non sono JSON, o JSON senza forma JSON-RPC (`method`, oppure `id` con `result` o `error`), si registrano e si ignorano; le righe `Token usage:` si scartano (`codexAppServerManager.ts:341`, `:394-404`, `:3161-3209`).
- Stderr: si tolgono i codici ANSI; delle righe di log strutturate passa solo `ERROR`, meno due errori noti innocui; ogni riga rimasta diventa evento `process/stderr` (`codexAppServerManager.ts:333-340`, `:937-957`, `:3072-3086`). L'adattatore lo porta a `runtime.warning` (`provider/Layers/CodexAdapter.ts:268-276`).
- Richieste: id intero crescente, scadenza di 20 s per richiesta, errore "Timed out waiting for <method>." (`codexAppServerManager.ts:3612-3643`). Una risposta con `error.message` diventa "<method> failed: <messaggio>" (`:3594-3610`).
- Guasto del trasporto o uscita del processo: tutte le richieste in sospeso si rifiutano, la sessione passa a `error` o `closed` e si smonta; il messaggio cita l'operazione in corso se è `thread/resume` o `thread/fork` (`codexAppServerManager.ts:3090-3147`).
- `initialize` dichiara `clientInfo.name: "synara_desktop"` e `capabilities.experimentalApi: true` (`codexAppServerManager.ts:805-816`).

### Controllo di accesso

Il flusso è in `makeCheckCodexProviderStatus` (`apps/server/src/provider/Layers/ProviderHealth.ts:827-993`). Ambiente: lo stesso di una sessione, con overlay e `homePath` (`ProviderHealth.ts:797-802`). Timeout di 4 s per entrambi i comandi (`ProviderHealth.ts:115`, `:843`, `:923`).

| Passo | Esito | status / authStatus |
| --- | --- | --- |
| `codex --version` assente | "Codex CLI (`codex`) is not installed or not on PATH." | `error` / `unknown`, `available: false` (`:846-859`) |
| `--version` fallito, in timeout o con exit non zero | "Codex CLI is installed but failed to run." | `error` / `unknown`, `available: false` (`:861-885`) |
| Versione sotto `0.37.0` | messaggio di aggiornamento | `error` / `unknown` (`:888-898`; `provider/codexCliVersion.ts:9`, `:76-82`) |
| `model_provider` in `config.toml` diverso da `openai` | "Using a custom Codex model provider; OpenAI login check skipped." | `ready` / `unknown` (`:608`, `:821-825`, `:909-920`) |
| `codex -c mcp_servers={} login status` fallito o in timeout | "Could not verify Codex authentication status..." | `warning` / `unknown` (`:118`, `:922-955`) |

Nota: la sezione 5 descrive l'errore di `--version` come avviso; al commit attuale è `error` con `available: false` (`ProviderHealth.ts:861-885`).

Parsing dell'output di `login status` (`parseAuthStatusFromOutput`, `ProviderHealth.ts:501-597`), in minuscolo su stdout e stderr, in quest'ordine:

1. "unknown command", "unrecognized command", "unexpected argument": `warning` / `unknown` (`:509-519`).
2. "not logged in", "login required", "authentication required", "run \`codex login\`", "run codex login": `error` / `unauthenticated` (`:521-533`).
3. Stdout che inizia con `{` o `[`: si cerca un booleano in `authenticated`, `isAuthenticated`, `loggedIn`, `isLoggedIn`, anche dentro `auth`, `status`, `session`, `account` (`apps/server/src/provider/providerCliOutput.ts:45-65`). Vero: `ready` / `authenticated`; falso: `error` / `unauthenticated`; assente: `warning` / `unknown` (`ProviderHealth.ts:535-584`).
4. Exit 0: `ready` / `authenticated` (`:585-587`). Altrimenti `warning` / `unknown` con il dettaglio (`:589-596`).

Extra: `authLabel` da tipo e piano ("OpenAI API Key", "ChatGPT Plus Subscription", ...) (`ProviderHealth.ts:378-421`, `:959-970`); `voiceTranscriptionAvailable` vero solo con `authMethod` `chatgpt` o `chatgptAuthTokens` (`:288-295`); `supportsAutoRuntimeMode` se la versione è almeno `0.124.0` (`:899-901`; `codexCliVersion.ts:11`).

Dentro la sessione, `account/read` produce solo `CodexAccountSnapshot`: `apiKey` e tipo sconosciuto tengono Spark, `chatgpt` con piano `free`, `go` o `plus` no (`codexAppServerManager.ts:351`, `:428-455`). Il suo errore si ignora se il processo è vivo (`:1212-1224`).

### Catalogo modelli

- Fonte a runtime: `model/list` con `{ cursor: null, limit: 50, includeHidden: false }` (`codexAppServerManager.ts:2632-2656`). L'adattatore ignora l'input e chiama `manager.listModels()` senza thread, quindi la chiave è sempre `"__default__"` (`provider/Layers/CodexAdapter.ts:2328-2338`; `codexAppServerManager.ts:2633`).
- Processo usato: una sessione viva e pronta, altrimenti una sessione di scoperta per `cwd` (o `process.cwd()`), avviata con `initialize`, `initialized`, radice skill e `account/read`, fermata dopo 15 s senza richieste (`codexAppServerManager.ts:355`, `:2736-2775`, `:2857-2980`). Avvii concorrenti condividono la stessa promise (`:2857-2883`).
- Cache nel manager: mappa LRU di 128 voci senza scadenza (`codexAppServerManager.ts:984-1012`, `:2634-2640`). Sopra c'è la cache comune del servizio: fresca 10 min, poi servita e rivalidata fino a 24 h, fallimenti ripetuti per 30 s, tetto di 45 s per scoperta, 64 voci (`apps/server/src/provider/providerModelDiscoveryCache.ts:18-37`; `provider/Layers/ProviderDiscoveryService.ts:272-304`).
- Parsing (`provider/codexDiscoveryCatalog.ts:312-417`): lista da `items`, `data` o `models`; slug da `id`, `slug` o `model`; nome da `name`, `displayName`, `display_name` o slug. Si scartano voci non oggetto, senza slug, con nome vuoto o slug duplicato (`:315-342`). Sforzi da stringhe o oggetti (`reasoningEffort`, `reasoning_effort`, `value`), deduplicati per valore (`:344-382`). `defaultReasoningEffort` si tiene solo se è tra gli sforzi (`:383-385`, `:407-412`). `supportsFastMode` da sei nomi booleani, altrimenti vero se `additionalSpeedTiers` contiene `fast` (`:386-399`).
- Filtro a valle: descrittori che non passano lo schema si tolgono con un avviso (`ProviderDiscoveryService.ts:69-91`).
- Catalogo statico di ripiego: otto modelli da `gpt-6-astra` a `gpt-5.2` (`packages/contracts/src/model.ts:579-621`); predefinito `gpt-6-astra` (`model.ts:1138-1139`); alias come `"5.3"` verso `gpt-5.3-codex` (`model.ts:1170-1180`).
- Spark: se il piano non lo consente, `gpt-5.3-codex-spark` diventa il modello predefinito (`codexAppServerManager.ts:349-350`, `:765-774`).

### Opzioni

```ts
// packages/contracts/src/model.ts:99-104
CodexModelOptions = { reasoningEffort?: TrimmedNonEmptyString; fastMode?: boolean }
// packages/contracts/src/orchestration.ts:112-117, 189-192
CodexModelSelection = { provider: "codex"; model: TrimmedNonEmptyString; options?: CodexModelOptions }
CodexProviderStartOptions = { binaryPath?: string; homePath?: string }
```

- Sforzo aperto: `CodexReasoningEffort = string`, con elenco noto `low`, `medium`, `high`, `xhigh` (`model.ts:5-7`). I livelli statici arrivano a `max` e `ultra` per `gpt-6-astra` (`model.ts:242-252`).
- `fastMode` vero dà `serviceTier: "fast"`, falso dà `"default"`, assente non manda nulla e Codex tiene il valore precedente (`apps/server/src/codexServiceTier.ts:3-12`).
- Modalità di esecuzione verso parametri di thread e di turno (`codexAppServerManager.ts:613-639`, `:718-744`):

| `runtimeMode` | `approvalPolicy` | `approvalsReviewer` | sandbox thread / turno |
| --- | --- | --- | --- |
| `approval-required` | `untrusted` | `user` | `read-only` / `readOnly` |
| `auto` | `on-request` | `auto_review` | `workspace-write` / `workspaceWrite` |
| `full-access` (predefinito) | `never` | `user` | `danger-full-access` / `dangerFullAccess` |

- "Consenti sempre" resta come stato di sessione e si rimanda a ogni `turn/start` (`codexAppServerManager.ts:746-763`).
- `interactionMode` diventa `collaborationMode` (`plan` o `default`) con modello (ripiego `gpt-5.3-codex`), sforzo (ripiego `medium`) e istruzioni per lo sviluppatore (`codexAppServerManager.ts:818-848`).
- `turn/start` manda `summary: "auto"`, `"none"` per Spark (`codexAppServerManager.ts:1456-1471`).

### Capacità dichiarate

Oggetto `capabilities` (`provider/Layers/CodexAdapter.ts:2467-2477`):

| Campo | Valore |
| --- | --- |
| `sessionModelSwitch` | `"in-session"` |
| `supportsSkillMentions` | `true` |
| `supportsSkillDiscovery` | `true` |
| `supportsNativeSlashCommandDiscovery` | `false` |
| `supportsPluginMentions` | `true` |
| `supportsPluginDiscovery` | `true` |
| `supportsRuntimeModelList` | `true` |
| `supportsTurnSteering` | `true` |
| `supportsLiveTurnDiffPatch` | `true` |

`conversationRollback` non c'è. Metodi esposti oltre al minimo: `steerTurn`, `startReview`, `readExternalThread`, `compactThread`, `forkThread`, `listPlugins`, `readPlugin`, `prewarmVoice`, `transcribeVoice`; `didResumeSession` manca (`CodexAdapter.ts:2478-2501`). Le capacità del composer aggiungono `supportsThreadCompaction` e `supportsThreadImport` a `true` (`codexAppServerManager.ts:2685-2697`).

### Ciclo di vita e cursore di ripresa

Oltre ai passi della sezione 5:

- Avvio: una sessione già presente per il thread si ferma prima (`codexAppServerManager.ts:1117-1120`). Senza `cwd` si usa uno spazio di lavoro temporaneo (`:1123`). Una cartella di progetto sparita dà un messaggio dedicato invece di "Codex non installato" (`apps/server/src/codexWorkingDirectory.ts:8-26`).
- Controllo di versione prima di ogni avvio: `codex --version` asincrono, timeout 4 s con `SIGKILL`, output massimo 1 MiB (`codexAppServerManager.ts:323-324`, `:4273-4347`). Minimi: `0.124.0` per `auto`, `0.125.0` per `thread/resume` e `thread/fork`, che mandano `excludeTurns: true` (`provider/codexCliVersion.ts:10-13`; `codexAppServerManager.ts:650-708`). Esito positivo in cache 10 min per binario, home e minimo, invalidato se il file del binario cambia; i fallimenti non si mettono in cache (`codexAppServerManager.ts:331`, `:4413-4508`).
- `thread/start` manda `experimentalRawEvents: false` (`codexAppServerManager.ts:687-690`).
- Un thread già legato che riparte con `thread/start` emette `session/threadStartWithoutResume` (`codexAppServerManager.ts:710-715`, `:1242-1263`).
- Il ripiego su `thread/start` vale solo se il messaggio contiene "thread/resume" e uno dei testi di "thread inesistente" (`codexAppServerManager.ts:342-348`, `:959-966`). "already has an active writer" diventa un messaggio che chiede di chiudere l'altro client Codex (`:968-978`).
- Pronto: `resumeCursor: { threadId }`, poi `session/threadOpenResolved`, `session/ready`, `session/started` (`codexAppServerManager.ts:3652-3680`). Il cursore si legge solo se è un oggetto con `threadId` stringa non vuota (`:4516-4526`).
- Errore di avvio: `CodexSessionStartError` solo se lo smontaggio è certificato prima dell'uscita; l'adattatore lo marca `reason: "startup-failed"` (`codexAppServerManager.ts:1405-1409`; `apps/server/src/codexErrorClassification.ts:5-8`; `provider/Layers/CodexAdapter.ts:2069-2081`).
- Steering: se la sessione non è `running` diventa un `sendTurn`; altrimenti `turn/steer` con `expectedTurnId`, e l'id del turno si legge da `response.turnId` (`codexAppServerManager.ts:1514-1546`).
- Watchdog: tempo di inattività 900 s (variabile `SYNARA_CODEX_TURN_IDLE_TIMEOUT_MS`), controllo ogni 15 s, pausa mentre si aspetta una persona, armato anche subito dopo `turn/start` (`provider/Layers/CodexAdapter.ts:102-106`, `:1927-1994`, `:2092-2094`).
- Ripiego su `task_complete`: se manca `turn/completed`, il turno si chiude da solo dopo 750 ms (`codexAppServerManager.ts:1063`, `:3731-3761`).
- Rotazione della credenziale: a ogni fine del turno principale il bearer del gateway si ritira (`codexAppServerManager.ts:3246-3265`). Il turno dopo è rifiutato da quella sessione (`:1415-1419`); `ProviderService` salva il cursore, ferma la sessione e la riapre con ripresa e una credenziale nuova (`provider/Layers/ProviderService.ts:1430-1478`).
- Stop: le risposte alle richieste parcheggiate hanno 2 s al massimo (`codexAppServerManager.ts:357-368`, `:2417-2440`).

### Iniezione degli strumenti host

- Blocco TOML aggiunto alla config sovrapposta (`apps/server/src/agentGateway/mcpInjection.ts:44-53`):

```toml
# mcpInjection.ts:44-53
[mcp_servers.synara]
url = "<endpoint>"
bearer_token_env_var = "SYNARA_AGENT_GATEWAY_TOKEN"

[shell_environment_policy]
exclude = ["SYNARA_AGENT_GATEWAY_TOKEN"]
```

- Il token non va nel file: si mette nell'ambiente del singolo processo (`codexAppServerManager.ts:1073-1087`); l'esclusione lo tiene fuori dai comandi del workspace (`mcpInjection.ts:33-43`). Una lease per thread si prende prima dello spawn (`codexAppServerManager.ts:1165-1173`; `provider/Layers/CodexAdapter.ts:1903-1911`).
- Home sovrapposta: `$SYNARA_HOME/codex-home-overlay` o `.synara/runtime/codex-home-overlay` accanto alla home sorgente (`apps/server/src/codexHomePaths.ts:13`, `:27-34`). Le voci della home sorgente si collegano con symlink, `auth.json` per primo e copiato se il link fallisce; `config.toml` e i file SQLite restano fuori (`apps/server/src/codexProcessEnv.ts:24`, `:162-198`, `:644-679`). `CODEX_SQLITE_HOME` punta alla home sorgente, salvo valore dell'utente (`codexProcessEnv.ts:755-760`).
- La config sovrapposta copia quella dell'utente, disattiva i plugin browser concorrenti e aggiunge la parte gestita tra marcatori; un `[mcp_servers.synara]` dell'utente si sostituisce solo nella copia (`codexProcessEnv.ts:35-39`, `:580-622`, `:680-718`).
- Su macOS e Linux, se la chiave del provider personalizzato manca, `PATH`, `SSH_AUTH_SOCK` e quella chiave si leggono dalla shell di login (`codexProcessEnv.ts:23`, `:766-793`).
- Istruzioni: ogni `collaborationMode` porta le regole per gli strumenti browser e `SYNARA_GATEWAY_HARNESS_POLICY` (`codexAppServerManager.ts:457-470`, `:597`, `:610`).
- Skill: `skills/extraRoots/set` registra la cartella delle skill di Synara; su versioni vecchie l'errore si registra e basta (`codexAppServerManager.ts:1089-1107`).
- Interruzione: tombstone del turno sul gateway con tetto di 2 s, rilascio della lease, poi `turn/interrupt` (`codexAppServerManager.ts:985`, `:1618-1684`, `:1729-1751`). Per il canale MCP vedi sezione 2.

### Eventi d'uso

- `thread/tokenUsage/updated` diventa `thread.token-usage.updated`; il payload si legge da `payload.tokenUsage` o dal payload intero (`provider/Layers/CodexAdapter.ts:1305-1320`).
- `normalizeCodexTokenUsage` (`CodexAdapter.ts:278-334`) accetta snake_case e camelCase: `total_token_usage`/`total`, `last_token_usage`/`last`, `model_context_window`. `usedTokens` viene da `last.total_tokens` o, in mancanza, dal totale; zero o assente scarta l'evento (`:283-289`). `cumulativeUsage` c'è solo con input e output totali (`:307-316`). `totalProcessedTokens` solo se supera l'usato (`:317-319`). `compactsAutomatically` è sempre `true` (`:332`).
- `turn/completed` porta `usage`, `modelUsage`, `totalCostUsd` se presenti (`CodexAdapter.ts:1340-1357`).
- `account/rateLimits/updated` passa il payload intero come `rateLimits` (`CodexAdapter.ts:1720-1730`).

### Casi limite dai test

Trasporto e processo:
- UTF-8 spezzato, riga oversize o non terminata (`apps/server/src/codexAppServerTransport.test.ts:28`, "frames split UTF-8 and rejects invalid, oversize, or unterminated input"); limite esatto e rilascio del buffer (`:53`); scritture lente entro il budget (`:84`).
- Stdout sporco: diagnostica leggibile (`apps/server/src/codexAppServerManager.test.ts:1523`), JSON autonomo da comandi (`:1538`), frammenti malformati (`:1553`), footer `Token usage` (`:1508`).
- Stderr: log non di errore ignorati (`codexAppServerManager.test.ts:835`), errori innocui (`:841`), argomento duplicato normalizzato (`:867`).
- Primo guasto del trasporto conservato fino allo smontaggio (`codexAppServerManager.test.ts:5108`); un solo stop in volo (`:5207`); lease rilasciata una volta a uscita spontanea (`:760`).
- Scadenza invariata per `thread/start`, `thread/resume`, `thread/fork` (`apps/server/src/codexSessionStartup.test.ts:117`, "keeps %s on the existing request deadline"); causa conservata per `initialize`, `account/read`, `thread/resume` (`:152`).

Versione e accesso:
- Probe memorizzato e condiviso (`codexAppServerManager.test.ts:877`); verdetto generale non riusato per `auto` (`:936`); versione illeggibile rifiutata per `auto` (`:980`); binario sostituito allo stesso percorso (`:1027`, `:1065`); fallimento non in cache (`:1106`).
- Cartella di progetto mancante segnalata come tale (`codexAppServerManager.test.ts:2116`); versioni minime per `auto`, ripresa e fork (`:2212`, `:2246`, `:2287`).
- Stato: pronto e autenticato (`apps/server/src/provider/Layers/ProviderHealth.test.ts:1050`), CLI assente (`:1158`), versione vecchia (`:1170`), `auto` non disponibile (`:1193`), "login required" (`:1213`), "not logged in" (`:1239`), comando non supportato (`:1264`), provider personalizzato (`:1294`), `openai` esplicito (`:1346`), exit 0 senza marcatori (`:1370`), JSON falso (`:1376`), JSON senza marcatore (`:1386`), parsing di `model_provider` in TOML (`:1400-1460`).

Sessione e turni:
- Apertura thread: fork (`codexAppServerManager.test.ts:1613`), ripresa senza opzioni di start (`:1629`), start con eventi grezzi spenti (`:1645`), ripresa e fork insieme rifiutati (`:1657`); ripiego solo per "non trovato" (`:1583`, `:1595`).
- Ripresa di un thread lungo senza replay (`codexAppServerManager.test.ts:1802`); `session/started` dopo ogni apertura (`:2039`); `experimentalApi` in `initialize` (`:2076`).
- Spark: piano plus senza Spark (`codexAppServerManager.test.ts:1738`), ripiego sul predefinito (`:1780`), riepiloghi spenti (`:2660`).
- `turn/start`: testo e immagini (`codexAppServerManager.test.ts:2344`), override di `approval-required` (`:2394`) e `auto` (`:2417`), modalità piano e predefinita (`:2440`, `:2472`), input vuoto rifiutato (`:2650`), nuovo turno anche con sessione `running` (`:2588`).
- Steering: turno attivo (`codexAppServerManager.test.ts:2681`); id del turno obbligatorio (`:2714`).
- Adattatore: provider sbagliato (`apps/server/src/provider/Layers/CodexAdapter.test.ts:213`), opzioni verso sessione e turno (`:237`, `:350`), Fast spento esplicito (`:289`, `:392`), sessione ignota (`:324`), errori con `willRetry` o non fatali a `runtime.warning` (`:1091`, `:1127`), stderr ad avviso (`:1167`), uso token (`:1613`), eventi non mappati limitati e raggruppati (`:1813`, `:1908`).
- Manager e rotazione: bearer ritirato prima di ogni evento terminale (`codexAppServerManager.test.ts:4886`); `task_complete` senza `turn/completed` (`:4778`); turno già inattivo chiuso in locale (`:3725`).

Scoperta e iniezione:
- `model/list` con i parametri fissi (`codexAppServerManager.test.ts:2837`); sforzi camelCase e snake_case (`apps/server/src/provider/codexDiscoveryCatalog.test.ts:32`, "normalizes $responseShape model/list reasoning efforts").
- Sessione di scoperta: grazia riavviata (`codexAppServerManager.test.ts:2730`), stop per inattività (`:2794`), per `cwd` (`:2883`), avvio condiviso (`:3028`).
- TOML con variabile e non token (`apps/server/src/agentGateway/mcpInjection.test.ts:51`), unione con la policy dell'utente (`:70`), commenti ignorati (`:97`).
- Overlay: copia di `auth.json` (`apps/server/src/codexProcessEnv.test.ts:17`), `CODEX_SQLITE_HOME` dell'utente tenuto (`:160`), tabella `synara` sostituita solo nella copia (`:182`), SQLite fuori dall'overlay (`codexAppServerManager.test.ts:1378`).

### In Trama

- `CodexClient` implementa il `protocol ProviderAdapter` della sezione 5, con le capacità della tabella sopra copiate in `ProviderCapabilities`, più i flag di V08.
- Trasporto: `Process` con tre `Pipe`, un `actor CodexTransport` che legge `Data` fino a `0x0A`, toglie `\r`, decodifica UTF-8 in modo stretto e rispetta gli stessi due limiti (16 MiB per riga, 32 MiB in coda). Ogni riga non JSON-RPC si registra e si scarta. Le risposte si abbinano con `[Int: CheckedContinuation]` e una `Task` di scadenza da 20 s. Le notifiche escono come `AsyncStream<CodexTransportEvent>`.
- Messaggi: `Codable` per `initialize`, `thread/start|resume|fork`, `turn/start`, `turn/steer`, `model/list`; i payload variabili come `JSONValue`. `parseCodexModelListResponse` va portato con tutte le alternative di chiave, perché i test coprono entrambe le forme.
- Accesso: `struct CodexAccessProbe` con due `Process` (`codex --version`, `codex -c mcp_servers={} login status`), timeout 4 s, e le regole di testo della tabella. Il risultato va in `AccountStatus`; il caso `model_provider` personalizzato dà `unknown`. `account/read` resta per Spark e piano.
- Versione: `actor CodexVersionGate` con cache di 10 min per binario, home e minimo, invalidata dal cambio di inode o data del file; mai in cache i fallimenti.
- Cursore V02: JSON opaco `{ "threadId": ... }` nel documento del progetto. Ripiego su `thread/start` solo per "thread inesistente", con l'evento dichiarato.
- Modello: Synara usa `gpt-6-astra` come predefinito; per le prove reali Trama usa solo `gpt-5.6-luna` (`docs/adr/0008-provider-di-synara-in-swift.md`, riga "Conseguenze", nel repository Trama).
- Strumenti host: stessa tecnica, blocco `[mcp_servers.<nome>]` con `bearer_token_env_var` e `shell_environment_policy.exclude`, token solo in `Process.environment`. La rotazione a ogni turno va decisa: Synara riavvia il processo con ripresa dopo ogni turno.
- Home sovrapposta: da valutare con `FileManager.createSymbolicLink`; serve solo se Trama deve modificare la config di Codex.

### Da non portare

- `Layer`, `ServiceMap.Service`, `Effect.acquireRelease`, `Queue.bounded`, `Stream.fromQueue`, `Effect.tryPromise` dell'adattatore (`provider/Layers/CodexAdapter.ts:1877-2505`).
- `EventEmitter`, `ChildProcessWithoutNullStreams`, `Writable` con `drain`, `setTimeout(...).unref()` (`codexAppServerManager.ts:1014`, `codexAppServerTransport.ts:257-318`).
- Gestione Windows: copia di `auth.json` per symlink negati, comandi shell mancanti, `ELECTRON_RUN_AS_NODE` (`codexProcessEnv.ts:162-183`; `ProviderHealth.ts:647-658`; `mcpInjection.ts:224-239`).
- Trascrizione vocale via token ChatGPT (`codexAppServerManager.ts:2658-2683`, `:2777-2855`), revisioni (`startReview`), plugin e marketplace, sottothread collaborativi: fuori dal verticale.
- Istruzioni del browser di Synara e `SYNARA_GATEWAY_HARNESS_POLICY` come testo (`codexAppServerManager.ts:457-470`): Trama ha i suoi strumenti.
- `ProviderHealth` in stile Effect con `ChildProcessSpawner` (`ProviderHealth.ts:619-645`).

### Non trovato

- Paginazione di `model/list`: nessun uso di `nextCursor`; si chiede solo la prima pagina con `cursor: null` e `limit: 50` (`codexAppServerManager.ts:2643-2647`). Cercato `nextCursor` nel manager e nel catalogo.
- Scadenza della cache modelli nel manager: solo LRU a 128 voci, nessun TTL (`codexAppServerManager.ts:984-1012`).
- `didResumeSession` nell'adattatore Codex: assente dall'oggetto restituito (`provider/Layers/CodexAdapter.ts:2465-2502`).
- Flag di capacità per thread persistente, ripresa, strumenti host, override per turno e uso token: cercati in `provider/Services/ProviderAdapter.ts`, trovato solo `didResumeSession` (`ProviderAdapter.ts:118`).
- Test del timeout di `codex login status`: cercato "Timed out" in `ProviderHealth.test.ts`, presente solo per Claude e OpenCode.
- Test di `normalizeCodexModelSlug` con preferenza `-codex` oltre ai tre casi di `codexAppServerManager.test.ts:1567-1576`: nessun altro trovato.
