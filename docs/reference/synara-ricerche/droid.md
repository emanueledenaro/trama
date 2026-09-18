## NN. Provider Droid

Ticket: P05. Droid è l'agente da riga di comando di Factory; Synara lo avvia come `droid exec --output-format acp` e ci parla in ACP su stdio (`apps/server/src/provider/acp/DroidAcpSupport.ts:2`, `apps/server/src/provider/acp/DroidAcpSupport.ts:116`). Il runtime generico è descritto nella sezione Runtime ACP condiviso; qui c'è solo ciò che è proprio di Droid. Tutti i percorsi sono relativi alla radice di Synara.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Layers/DroidAdapter.ts` | adattatore completo (sessioni, turni, eventi, scoperta) |
| `apps/server/src/provider/Services/DroidAdapter.ts` | interfaccia del servizio, `provider: "droid"` (righe 11-17) |
| `apps/server/src/provider/acp/DroidAcpSupport.ts` | comando, autenticazione, modello, modalità, catalogo |
| `apps/server/src/provider/acp/DroidSessionTeardownGate.ts` | attesa della chiusura prima di una nuova sessione |
| `apps/server/src/provider/acp/DroidTurnCancellation.ts` | annullamento con attesa e interruzione forzata |
| `apps/server/src/provider/FactoryPluginDiscovery.ts` | plugin dai marketplace locali di Factory |
| `apps/server/src/provider/FactorySessionHistory.ts` | import della cronologia da `~/.factory/sessions` |
| `apps/server/src/provider/Layers/ProviderHealth.ts:1269-1345` | stato di accesso |
| `apps/server/src/agentGateway/mcpInjection.ts:264-291` | voci `mcpServers` per ACP |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `settings.ts` | opzioni, selezione, impostazioni |

Test: `Layers/DroidAdapter.test.ts`, `acp/DroidAcpSupport.test.ts`, `acp/DroidSessionTeardownGate.test.ts`, `acp/DroidTurnCancellation.test.ts`, `FactoryPluginDiscovery.test.ts`, `FactoryPluginDiscovery.dot-prefix.test.ts`, `FactorySessionHistory.test.ts`, tutti sotto `apps/server/src/provider/`.

### Trasporto

- Eseguibile: percorso configurato se non vuoto, poi ricerca standard di `droid`, poi `~/.local/bin/droid` sui sistemi POSIX, altrimenti `droid` (`apps/server/src/provider/acp/DroidAcpSupport.ts:88-110`).
- Argomenti: `exec --output-format acp`, più `--append-system-prompt <testo>`, `-m <modello>`, `-r <sforzo>` se presenti (`apps/server/src/provider/acp/DroidAcpSupport.ts:116-128`). L'ambiente è quello filtrato per il provider `droid` (`apps/server/src/provider/acp/DroidAcpSupport.ts:134`).
- In modalità ACP `droid exec` ignora `-m` e `-r`; modello e sforzo si applicano con `session/set_config_option` (`apps/server/src/provider/acp/DroidAcpSupport.ts:182-190`).
- Il testo aggiunto al prompt di sistema è sempre `DROID_RESOURCE_DISCIPLINE_PROMPT`, che chiede di non sovrapporre build, test e comandi pesanti (`apps/server/src/provider/Layers/DroidAdapter.ts:164-165`, `apps/server/src/provider/Layers/DroidAdapter.ts:795-807`).
- Il client dichiara `clientCapabilities: { elicitation: { form: {} } }` e `clientInfo` `Synara` (`apps/server/src/provider/Layers/DroidAdapter.ts:825-826`).

Tempi propri di Droid:

| Costante | Valore | Riga |
| --- | --- | --- |
| richiesta ACP (`session/start`, config) | 30 s | `apps/server/src/provider/Layers/DroidAdapter.ts:159` |
| attesa della riproduzione all'avvio | 3 s | `apps/server/src/provider/Layers/DroidAdapter.ts:160` |
| turno senza attività | 600 s, `SYNARA_DROID_TURN_IDLE_TIMEOUT_MS` | `apps/server/src/provider/Layers/DroidAdapter.ts:151-154` |
| turno con un sotto-agente `Task` attivo | 60 min | `apps/server/src/provider/Layers/DroidAdapter.ts:156`, `:1729-1732` |
| controllo del watchdog | 15 s | `apps/server/src/provider/Layers/DroidAdapter.ts:155` |
| grazia dell'annullamento | 5 s | `apps/server/src/provider/Layers/DroidAdapter.ts:157` |
| svuotamento eventi a fine turno | max 1 s, passo 25 ms | `apps/server/src/provider/Layers/DroidAdapter.ts:145-146` |

### Controllo di accesso

Autenticazione ACP: se `FACTORY_API_KEY` non è vuota e l'agente offre `factory-api-key`, si usa quella; altrimenti `device-pairing`; altrimenti errore -32602 "Droid ACP authentication is unavailable." con il suggerimento di lanciare `droid` o impostare la chiave (`apps/server/src/provider/acp/DroidAcpSupport.ts:62-78`, `apps/server/src/provider/acp/DroidAcpSupport.ts:142-161`). La richiesta `authenticate` porta `_meta: { headless: true }` (`apps/server/src/provider/acp/DroidAcpSupport.ts:172`).

Stato mostrato (`makeCheckDroidProviderStatus`, `apps/server/src/provider/Layers/ProviderHealth.ts:1274-1345`). Si esegue solo `droid --version` con timeout `DEFAULT_TIMEOUT_MS` di 4 s (`apps/server/src/provider/Layers/ProviderHealth.ts:115`, `:1281-1284`). Non c'è un comando di login da interrogare.

| Esito di `--version` | status | available | authStatus | Messaggio |
| --- | --- | --- | --- | --- |
| eseguibile assente | `error` | false | `unknown` | "Droid CLI (`droid`) is not installed or not on PATH." (`:1286-1299`) |
| errore di avvio | `error` | false | `unknown` | "Failed to execute Droid CLI health check: ..." (`:1296-1297`) |
| timeout | `error` | false | `unknown` | "...failed to run. Timed out while running command." (`:1301-1311`) |
| uscita non zero | `error` | false | `unknown` | "...failed to run." più il dettaglio (`:1313-1325`) |
| successo con `FACTORY_API_KEY` | `ready` | true | `authenticated` | `authType: "apiKey"`, `authLabel: "Factory API Key"` (`:1326-1338`) |
| successo senza chiave | `ready` | true | `unknown` | invita a usare il login in cache di `droid` o la chiave (`:1339-1342`) |

La versione si legge con `parseGenericCliVersion` da stdout e stderr (`apps/server/src/provider/Layers/ProviderHealth.ts:1326`). L'aggiornamento nativo è `droid update`, pacchetto npm `@factory/cli` (`apps/server/src/provider/Layers/ProviderHealth.ts:239-250`).

### Catalogo modelli

- Fonte: una sessione ACP usa e getta (`Synara Model Discovery`) che non entra nell'elenco delle sessioni (`apps/server/src/provider/Layers/DroidAdapter.ts:448-462`, `:2025-2031`).
- `discoverDroidAcpModels` cerca l'opzione select con id `model` o categoria `model`; se manca fallisce con "Droid ACP did not advertise a model configuration option." (`apps/server/src/provider/acp/DroidAcpSupport.ts:295-305`).
- Per ogni modello, uno alla volta, imposta il modello e rilegge l'opzione `reasoning_effort` o categoria `thought_level`; se la prova fallisce il modello resta selezionabile senza sforzi (`apps/server/src/provider/acp/DroidAcpSupport.ts:313-331`). Poi ripristina modello e sforzo iniziali ignorando gli errori (`apps/server/src/provider/acp/DroidAcpSupport.ts:333-340`).
- Descrittore: `slug` = valore, `name`, sforzi con etichette, un `optionDescriptors` `reasoningEffort`, `supportsFastMode: false`, `supportsThinkingToggle: false` (`apps/server/src/provider/acp/DroidAcpSupport.ts:252-285`). Gruppi di opzioni si appiattiscono (`apps/server/src/provider/acp/DroidAcpSupport.ts:236-240`). `source: "droid-acp"`, `cached: false` (`apps/server/src/provider/acp/DroidAcpSupport.ts:342-346`).
- Cache: chiave `binaryPath\0cwd`, validità 5 minuti, al massimo 16 voci con rimozione della più vecchia; una risposta in cache torna con `cached: true` (`apps/server/src/provider/Layers/DroidAdapter.ts:161-163`, `:390-398`, `:2020-2024`, `:2044-2047`). La stessa sessione riempie anche la cache dei comandi (`apps/server/src/provider/Layers/DroidAdapter.ts:2032-2043`).
- Un semaforo serializza le scoperte; timeout totale 30 s con "Timed out while discovering Droid models over ACP." (`apps/server/src/provider/Layers/DroidAdapter.ts:162`, `:430`, `:2061-2074`).
- Catalogo statico nei contratti: 37 voci, prima `auto` (`packages/contracts/src/model.ts:702-889`), predefinito `claude-opus-4-8` (`packages/contracts/src/model.ts:1145`), alias (`packages/contracts/src/model.ts:1250-1287`). L'adattatore non lo importa.
- Comandi slash: stessa sessione usa e getta, fino a 500 ms di attesa se l'elenco è vuoto, `source: "droid-acp"`, `forceReload` salta la cache (`apps/server/src/provider/Layers/DroidAdapter.ts:2130-2198`).

### Opzioni

- `DroidModelOptions`: solo `reasoningEffort`, stringa non vuota libera (`packages/contracts/src/model.ts:145-148`). La lista `off, none, minimal, low, medium, high, xhigh, max` serve solo da ripiego offline (`packages/contracts/src/model.ts:34-46`).
- `DroidModelSelection` con `provider: "droid"` (`packages/contracts/src/orchestration.ts:148-153`); opzioni di avvio solo `binaryPath` (`packages/contracts/src/orchestration.ts:213-215`); impostazione `binaryPath` con predefinito `droid` (`packages/contracts/src/settings.ts:45-49`).
- Applicazione: prima `model`, poi `reasoning_effort` (`apps/server/src/provider/acp/DroidAcpSupport.ts:191-213`), all'avvio dopo la riproduzione e di nuovo a ogni turno (`apps/server/src/provider/Layers/DroidAdapter.ts:1283-1301`, `:1462-1482`).
- Modalità per turno: piano dà `spec`, `full-access` dà `auto-high`, il resto `normal`; se `session/set_mode` fallisce si prova `set_config_option` su `autonomy_level` (`apps/server/src/provider/acp/DroidAcpSupport.ts:57-60`, `:215-234`).
- In modalità piano il testo riceve il prefisso `DROID_PLAN_MODE_PROMPT_PREFIX` (`apps/server/src/provider/Layers/DroidAdapter.ts:166-171`, `:1495-1499`). `runtimeMode: "auto"` è rifiutato (`apps/server/src/provider/Layers/DroidAdapter.ts:1452-1458`).

### Capacità dichiarate

Oggetto `capabilities` (`apps/server/src/provider/Layers/DroidAdapter.ts:2213-2216`):

```ts
{ sessionModelSwitch: "restart-session", conversationRollback: "restart-session" }
```

`getComposerCapabilities` (`apps/server/src/provider/Layers/DroidAdapter.ts:1994-2007`): `supportsSkillMentions: false`, `supportsSkillDiscovery: false`, `supportsNativeSlashCommandDiscovery: true`, `supportsPluginMentions: true`, `supportsPluginDiscovery: true`, `supportsRuntimeModelList: true`, `supportsThreadCompaction: false` (ACP tratta `/compact` come testo normale), `supportsThreadImport: true`. Metodi esposti: `readExternalThread`, `forkThread`, `listCommands`, `listModels`, `listPlugins`, `readPlugin`; manca `compactThread` (`apps/server/src/provider/Layers/DroidAdapter.ts:2217-2235`).

### Ciclo di vita e cursore di ripresa

- Cursore: `{ schemaVersion: 1, sessionId }`; si scarta se la versione è diversa o l'id è vuoto (`apps/server/src/provider/Layers/DroidAdapter.ts:140`, `:370-375`, `:1010-1013`).
- Avvio sotto blocco per thread: attende la chiusura in corso dello stesso thread, risolve la cartella, ferma la sessione precedente (`apps/server/src/provider/Layers/DroidAdapter.ts:733-759`). La porta di chiusura tiene un `Deferred` per thread e una pulizia vecchia non cancella quella nuova (`apps/server/src/provider/acp/DroidSessionTeardownGate.ts:18-39`).
- Se si chiedeva una ripresa e il runtime ha creato una sessione nuova, l'avvio fallisce: "Synara refused the fresh fallback" (`apps/server/src/provider/Layers/DroidAdapter.ts:991-998`).
- La sessione si registra prima della configurazione; i turni attendono `sessionConfigReady` (`apps/server/src/provider/Layers/DroidAdapter.ts:260-266`, `:1276-1277`, `:1434-1436`). Eventi `session.started`, `session.state.changed` `ready`, `thread.started` (`apps/server/src/provider/Layers/DroidAdapter.ts:1317-1337`).
- Turno: rifiuta un secondo invio mentre il primo parte (`apps/server/src/provider/Layers/DroidAdapter.ts:1409-1415`); unisce testo, riferimenti, allegati e immagini, rifiuta un prompt vuoto (`apps/server/src/provider/Layers/DroidAdapter.ts:1491-1529`). Un errore del prompt chiude la sessione (`apps/server/src/provider/Layers/DroidAdapter.ts:1624-1631`).
- Interruzione: ignora un `turnId` vecchio (`apps/server/src/provider/Layers/DroidAdapter.ts:333-338`, `:1749-1756`), segna `pendingTurnInterrupted` se il prompt non è ancora partito, chiude approvazioni e domande, invia `session/cancel` con 5 s di grazia e poi chiude sempre il processo, perché Factory può confermare prima che i lavori annidati si fermino (`apps/server/src/provider/Layers/DroidAdapter.ts:1764-1782`). `cancelDroidTurnAndWait` restituisce `cancelRequest` `sent`/`failed`/`timedOut` e `prompt` `notStarted`/`settled`/`timedOut`, interrompendo il prompt oltre la grazia (`apps/server/src/provider/acp/DroidTurnCancellation.ts:7-51`).
- Stop idempotente: se la sessione è già ferma attende la chiusura pendente (`apps/server/src/provider/Layers/DroidAdapter.ts:1968-1983`); la chiusura del processo gira staccata ed emette `session.exited` (`apps/server/src/provider/Layers/DroidAdapter.ts:584-640`).
- Piano: lo strumento `Approve Spec` con `rawInput.plan` diventa `turn.proposed.completed`; il turno si annulla subito dopo il rifiuto atteso "plan not approved - remaining in spec mode", o dopo 1 s, e si chiude come `completed` (`apps/server/src/provider/Layers/DroidAdapter.ts:158`, `:340-360`, `:677-714`, `:1149-1188`, `:301-314`).
- Rollback: sempre errore di validazione, niente cursore nativo (`apps/server/src/provider/Layers/DroidAdapter.ts:1858-1874`). Fork: tramite `session/fork` sulla sessione attiva o su una ripresa temporanea; rifiutato con un turno in corso; restituisce solo il nuovo cursore (`apps/server/src/provider/Layers/DroidAdapter.ts:1876-1955`).
- Import: `readFactorySessionHistory` cerca `~/.factory/sessions/*/<id>.jsonl`, accetta solo id `[a-zA-Z0-9_-]+`, prende `cwd` da `session_start`, tiene i messaggi `user`/`assistant` visibili (niente `isUserVisible: false` o `visibility: "llm_only"`) con blocchi di testo (`apps/server/src/provider/FactorySessionHistory.ts:40-116`). I turni importati hanno id `factory:<id>:<indice>` (`apps/server/src/provider/Layers/DroidAdapter.ts:1827-1856`).
- Plugin: marketplace da `~/.factory/plugins/known_marketplaces.json`, manifest in `.factory-plugin/`, abilitazioni in ordine da feature flag, `settings.json`, `settings.local.json` utente e di progetto; i percorsi che escono dal marketplace si scartano (`apps/server/src/provider/FactoryPluginDiscovery.ts:64-130`, `:167-214`).

### Iniezione degli strumenti host

- Con credenziali del gateway l'adattatore prende una lease per thread e passa `buildMcpServers` al runtime (`apps/server/src/provider/Layers/DroidAdapter.ts:765-769`, `:827-836`). Il runtime la chiama dopo `initialize` e mette il risultato in `session/new` o `session/load` (`apps/server/src/provider/acp/AcpSessionRuntime.ts:393`, `:1788`, `:1873`, `:1900`, `:1927`).
- `buildAcpSynaraMcpServers`: se `agentCapabilities.mcpCapabilities.http` è vero, voce HTTP `synara` con header `Authorization: Bearer <token>`; altrimenti voce stdio con il proxy e le variabili `SYNARA_AGENT_GATEWAY_URL` e `SYNARA_AGENT_GATEWAY_TOKEN` (`apps/server/src/agentGateway/mcpInjection.ts:24-27`, `:264-291`).
- La lease si rilascia allo stop e all'uscita del processo; ogni fine turno annulla le richieste del gateway per quel turno (`apps/server/src/provider/Layers/DroidAdapter.ts:596-597`, `:844`, `:1596`, `:1643`, `:1767-1769`).
- La politica host di Synara si antepone una sola volta al primo prompt (`apps/server/src/provider/Layers/DroidAdapter.ts:132-139`, `:1530-1536`).

### Eventi d'uso

- `UsageUpdated` registra il costo e pubblica un evento di uso token solo con un turno attivo (`apps/server/src/provider/Layers/DroidAdapter.ts:1238-1258`).
- `turn.completed` porta `result.usage` se presente e il costo del turno (`apps/server/src/provider/Layers/DroidAdapter.ts:1648`, `:1682-1683`).
- Altri eventi propri: `task.started`/`task.completed` con `taskType: "subagent"` per le righe `Task` (`apps/server/src/provider/Layers/DroidAdapter.ts:513-570`, `:316-329`); i messaggi assistente vuoti e le delta di solo ragionamento non contano come contenuto (`apps/server/src/provider/Layers/DroidAdapter.ts:293-299`, `:1070-1103`); un aggiornamento strumento arrivato dopo la fine del turno resta sul turno di origine (`apps/server/src/provider/Layers/DroidAdapter.ts:1114-1142`).

### Casi limite dai test

- `apps/server/src/provider/Layers/DroidAdapter.test.ts:19` (delivers private scoped host context once)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:34` (prefers an explicit cwd over the active thread session cwd)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:38` (uses the active thread session cwd before the server fallback)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:44` (makes reused ACP assistant segment ids unique per turn)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:55` (extracts Droid's current Approve Spec plan and recognizes its expected rejection)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:78` (treats cancellation used to settle a captured Plan as successful completion)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:94` (preserves the provider tool id while scoping the runtime item id)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:112` (only treats visible assistant text as renderable Droid content)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:127` (recognizes Factory Task rows whose child progress is hidden from parent ACP)
- `apps/server/src/provider/Layers/DroidAdapter.test.ts:146` (ignores a delayed stop when its turn is no longer active)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:31` (prefers ~/.local/bin/droid when it exists)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:39` (builds the default Droid ACP command)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:47` (passes model, reasoning effort, and an appended system prompt without bypassing permissions)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:97` (sets the model before the reasoning effort)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:113` (skips the reasoning effort RPC when no effort is requested)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:125` (maps set_config_option failures through mapError)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:139` (uses native spec mode for Plan and restores Full Access on the next turn)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:169` (uses Droid's highest native autonomy outside plan mode for full-access sessions)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:188` (falls back to Droid's autonomy config for older ACP mode responses)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:213` (reads each model's reasoning choices from session config options)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:299` (prefers factory-api-key when FACTORY_API_KEY is set)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:307` (falls back to device-pairing)
- `apps/server/src/provider/acp/DroidAcpSupport.test.ts:315` (fails when no auth method is available)
- `apps/server/src/provider/acp/DroidSessionTeardownGate.test.ts:8` (blocks replacement work until the tracked teardown completes)
- `apps/server/src/provider/acp/DroidSessionTeardownGate.test.ts:37` (does not let stale cleanup clear a newer teardown gate)
- `apps/server/src/provider/acp/DroidTurnCancellation.test.ts:7` (keeps the prompt fiber alive until Droid settles it)
- `apps/server/src/provider/acp/DroidTurnCancellation.test.ts:30` (interrupts a prompt that does not settle within the grace window)
- `apps/server/src/provider/FactorySessionHistory.test.ts:20` (reads only user-visible Droid session messages)
- `apps/server/src/provider/FactoryPluginDiscovery.test.ts:87` (applies project Factory settings after user-level plugin settings)
- `apps/server/src/provider/FactoryPluginDiscovery.test.ts:125` (rejects marketplace paths that Factory has not registered)
- `apps/server/src/provider/FactoryPluginDiscovery.dot-prefix.test.ts:16` (accepts dot-prefixed children without allowing parent traversal)

### In Trama

Droid diventa un profilo del client ACP condiviso, senza un secondo runtime:

```swift
struct DroidACPProfile: ACPProviderProfile {
    let kind: ProviderKind = .droid
    func spawn(settings: DroidSettings, cwd: URL) -> ACPSpawn          // exec --output-format acp, -m, -r, --append-system-prompt
    func authMethod(for initialize: ACPInitializeResult, env: Environment) throws -> String // factory-api-key, poi device-pairing
    var authenticateMeta: [String: JSONValue] { ["headless": true] }
    func mcpServers(initialize: ACPInitializeResult, lease: GatewayLease) -> [ACPMcpServer] // HTTP se mcpCapabilities.http, altrimenti proxy stdio
    func applySelection(_ s: DroidModelSelection, on session: ACPSession) async throws  // model, poi reasoning_effort
    func applyMode(interaction: InteractionMode, runtime: RuntimeMode, on session: ACPSession) async throws // spec, auto-high, normal; fallback autonomy_level
}
```

- `DroidAdapter` (attore Swift) tiene per thread lo stato di `DroidSessionContext`: turno attivo, `Task` annidati, id strumenti del turno appena chiuso, `sessionConfigReady` come `AsyncStream` o continuation.
- `DroidTeardownGate` e `cancelDroidTurnAndWait` diventano funzioni `async` con `withTaskGroup` e timeout; l'interruzione chiude sempre il processo.
- Catalogo: `DroidModelDiscovery` con sessione usa e getta, cache LRU da 16 voci per 5 minuti, serializzata da un attore.
- `FactorySessionHistory` e `FactoryPluginDiscovery` si portano come lettori di file puri, testabili con cartelle temporanee.
- Stato di accesso: stessa tabella, con `droid --version` e timeout di 4 s.

### Da non portare

- Variabili di debug `SYNARA_DROID_ACP_DEBUG` e l'eredità `DP_DROID_ACP_DEBUG`, con il marcatore di trasporto (`apps/server/src/provider/Layers/DroidAdapter.ts:141-144`, `:206-210`).
- Il logger NDJSON nativo e il mirroring dei payload che contengono `droidShell` (`apps/server/src/provider/Layers/DroidAdapter.ts:464-483`, `:786-793`).
- La meccanica Effect di fibre, scope e daemon (`forkDetach`, `forkIn`), che in Swift diventa concorrenza strutturata (`apps/server/src/provider/Layers/DroidAdapter.ts:630-633`, `:1271-1274`).
- L'aggiornamento automatico `droid update` resta fuori da P05 (`apps/server/src/provider/Layers/ProviderHealth.ts:239-250`).

### Non trovato

- Un comando di login o di stato account per Droid: il controllo usa solo `--version` e la variabile d'ambiente, quindi `authStatus: "unauthenticated"` non viene mai prodotto. Cercato `login`, `auth` e `whoami` in `ProviderHealth.ts` e `DroidAcpSupport.ts`.
- Uno scarto con avviso delle voci malformate nel catalogo Droid: `droidModelDescriptor` usa `value` e `name` così come arrivano. Cercati `warn` e filtri in `DroidAcpSupport.ts`.
- Test di ciclo di vita completo dell'adattatore Droid (avvio, turno, stop con trasporto finto): `DroidAdapter.test.ts` ha 155 righe e solo funzioni pure.
- Un comando nativo di compattazione: `supportsThreadCompaction: false` e nessun `compactThread`.
- Un uso lato server del catalogo statico Droid dei contratti: nessun import di `MODEL_OPTIONS_BY_PROVIDER` in `DroidAdapter.ts`.
