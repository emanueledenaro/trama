## NN. Provider Devin

Ticket: P06. Devin è la CLI di Cognition; Synara la avvia come `devin acp` e ci parla in ACP su stdio, con le credenziali prese da `WINDSURF_API_KEY` o dal file scritto da `devin auth login` (`apps/server/src/provider/acp/DevinAcpSupport.ts:2-9`, `apps/server/src/provider/acp/DevinAcpSupport.ts:341`). Il runtime generico è descritto nella sezione Runtime ACP condiviso; qui c'è solo ciò che è proprio di Devin. Tutti i percorsi sono relativi alla radice di Synara.

### Percorsi dei file

| File | Ruolo |
| --- | --- |
| `apps/server/src/provider/Layers/DevinAdapter.ts` | adattatore completo, 3466 righe (sessioni, turni, catalogo, compattazione, recupero dai blocchi) |
| `apps/server/src/provider/Services/DevinAdapter.ts` | interfaccia del servizio, `provider: "devin"` (righe 11-17) |
| `apps/server/src/provider/acp/DevinAcpSupport.ts` | comando, autenticazione, URL del server, normalizzazione dei messaggi, `/compact` |
| `apps/server/src/provider/acp/DevinSessionConfig.ts` | cartella di configurazione usa e getta con il server MCP `synara` |
| `apps/server/src/provider/Layers/ProviderHealth.ts:1789-1869` | stato di accesso |
| `apps/server/src/agentGateway/mcpInjection.ts:24-27` | nomi e variabili riusate da `DevinSessionConfig` |
| `packages/contracts/src/model.ts`, `orchestration.ts`, `settings.ts` | opzioni, selezione, impostazioni |

Test: `Layers/DevinAdapter.test.ts` (1886 righe), `acp/DevinAcpSupport.test.ts` (925), `acp/DevinSessionConfig.test.ts` (127), tutti sotto `apps/server/src/provider/`.

### Trasporto

- Eseguibile: percorso configurato se non vuoto e diverso da `devin`, poi ricerca standard di `devin`, poi i percorsi Windows `devin/cli/bin/devin.exe` e `devin/bin/devin.exe` sotto LocalAppData, altrimenti `devin` (`apps/server/src/provider/acp/DevinAcpSupport.ts:136-149`).
- Argomenti: solo `acp`, più `--model <uid>` se il modello risolto non è vuoto. Il `runtimeMode` non produce nessun flag: i permessi passano da `session/request_permission` (`apps/server/src/provider/acp/DevinAcpSupport.ts:332-345`).
- Ambiente: quello filtrato per il provider `devin`, che concede solo `DEVIN_API_KEY` e `WINDSURF_API_KEY` (`apps/server/src/providerChildEnvironment.ts:60`). Se esiste la variante minuscola `windsurf_api_key`, viene normalizzata in `WINDSURF_API_KEY` per il figlio (`apps/server/src/provider/acp/DevinAcpSupport.ts:62-64`, `:347-357`). La chiave non finisce mai negli argomenti.
- `normalizeIncomingMessage` è `normalizeDevinGetOutputToolCall`: toglie il campo booleano `block` dagli `arguments` delle richieste `get_output`, lasciando intatto tutto il resto; se il metodo non è `get_output` o `block` non è booleano il messaggio passa invariato (`apps/server/src/provider/acp/DevinAcpSupport.ts:69-95`, `:448`). È l'unico provider che usa quel gancio.
- Il client dichiara `clientInfo` `Synara` e `clientCapabilities: { elicitation: { form: {} } }` (`apps/server/src/provider/Layers/DevinAdapter.ts:1904-1905`).
- `onChildStderrLine` legge il log rispecchiato del figlio per trovare i blocchi (`apps/server/src/provider/Layers/DevinAdapter.ts:1880-1896`, `:1908`).

Tempi propri di Devin:

| Costante | Valore | Riga |
| --- | --- | --- |
| turno senza attività | 30 min, `SYNARA_DEVIN_TURN_IDLE_TIMEOUT_MS` | `apps/server/src/provider/Layers/DevinAdapter.ts:339-343` |
| turno con uno strumento attivo | 60 min, `SYNARA_DEVIN_TOOL_IDLE_TIMEOUT_MS` | `apps/server/src/provider/Layers/DevinAdapter.ts:344-348`, `:1263-1273` |
| controllo del watchdog | `min(5 s, turno, strumento)` | `apps/server/src/provider/Layers/DevinAdapter.ts:1315` |
| fusibile dello stallo | 90 s, `SYNARA_DEVIN_STALL_FUSE_MS` | `apps/server/src/provider/Layers/DevinAdapter.ts:216-220` |
| avvio di comando mai pronto | 30 s, `SYNARA_DEVIN_SPAWN_STALL_TIMEOUT_MS` | `apps/server/src/provider/Layers/DevinAdapter.ts:221-225` |
| supervisore dei blocchi | 5 s | `apps/server/src/provider/Layers/DevinAdapter.ts:181` |
| quiete del replay di ripresa | 200 ms, attesa all'avvio 1,5 s, tetto 30 s | `apps/server/src/provider/Layers/DevinAdapter.ts:290-297` |
| lettura della modalità | 5 s | `apps/server/src/provider/Layers/DevinAdapter.ts:598` |
| scoperta modelli e comandi | 15 s, cache 5 min, 16 voci | `apps/server/src/provider/Layers/DevinAdapter.ts:279-283` |
| svuotamento eventi a fine turno | max 1 s, passo 25 ms | `apps/server/src/provider/Layers/DevinAdapter.ts:300-301` |
| `/compact` | quanto il turno; quiete dopo l'abbandono 5 s; attesa del cancel 10 s | `apps/server/src/provider/Layers/DevinAdapter.ts:304`, `:308`, `:313` |

### Controllo di accesso

Autenticazione ACP con `authPolicy: "on-demand"`: prima si prova il setup della sessione, e solo se fallisce con un errore di autenticazione si chiama `authenticate` (`apps/server/src/provider/acp/DevinAcpSupport.ts:440`). `validateInitializeResult` esegue la stessa risoluzione subito dopo `initialize`, così un agente senza metodi headless fallisce prima di creare la sessione (`apps/server/src/provider/acp/DevinAcpSupport.ts:443-446`).

`resolveDevinAcpAuthMethodId` (`apps/server/src/provider/acp/DevinAcpSupport.ts:373-418`):

1. Con una chiave disponibile, il primo metodo annunciato tra `windsurf-api-key`, `windsurf.api_key`, `devin.api_key`, `api_key` (`:48-53`).
2. Sempre con una chiave, se l'agente annuncia solo `devin-browser` si usa comunque `windsurf-api-key`, perché Devin 3000.3.x lo accetta con `_meta.api_key` (`:387-392`).
3. Altrimenti `cached_token` se annunciato (`:394-396`).
4. Altrimenti il primo metodo non interattivo, cioè fuori da `browser_login`, `devin-browser`, `devin.com`, `oauth` (`:56-61`, `:399-404`).
5. Senza chiave e con solo metodi interattivi: errore -32602 con `reason: "credentials_missing"` e il testo che invita a impostare `WINDSURF_API_KEY` o a fare login (`:406-412`).
6. Negli altri casi errore -32602 con `reason: "compatibility_mismatch"` (`:413-417`).

`_meta` della richiesta `authenticate`: sempre `headless: true`, più `api_key` e `api_server_url` quando ci sono (`apps/server/src/provider/acp/DevinAcpSupport.ts:280-303`). Le chiavi si leggono da `WINDSURF_API_KEY`, `DEVIN_API_KEY`, `windsurf_api_key`; gli URL da `WINDSURF_API_SERVER_URL` e `DEVIN_API_SERVER_URL` (`:64-65`, `:122-130`, `:151-159`). Le credenziali salvate stanno in `$XDG_DATA_HOME/devin/credentials.toml` (con ripiego `~/.local/share`) o in `%APPDATA%/devin/credentials.toml`, e il parser legge solo `windsurf_api_key` e `api_server_url` (`:184-228`).

`validateDevinApiServerUrl` accetta solo HTTPS, oppure HTTP esplicito su loopback; rifiuta URL malformati, schemi diversi, credenziali nell'URL e HTTP non loopback, e toglie query e frammento più le barre finali (`apps/server/src/provider/acp/DevinAcpSupport.ts:247-275`). Un URL rifiutato produce -32602 con `reason: "invalid_api_server_url"` e nessuna chiave allegata (`:277-297`).

Stato mostrato (`makeCheckDevinProviderStatus`, `apps/server/src/provider/Layers/ProviderHealth.ts:1791-1869`). Si esegue solo `devin --version` con timeout `DEFAULT_TIMEOUT_MS` di 4 s (`apps/server/src/provider/Layers/ProviderHealth.ts:115`, `:1800-1803`).

| Esito di `--version` | status | available | authStatus | Messaggio |
| --- | --- | --- | --- | --- |
| eseguibile assente | `error` | false | `unknown` | "Devin CLI (`devin`) is not installed or not on PATH." (`:1806-1818`) |
| errore di avvio | `error` | false | `unknown` | "Failed to execute Devin CLI health check: ..." (`:1816`) |
| timeout | `error` | false | `unknown` | "Devin CLI is installed but failed to run. Timed out while running command." (`:1820-1830`) |
| uscita non zero | `error` | false | `unknown` | "...failed to run." più il dettaglio (`:1832-1845`) |
| successo con chiave in ambiente o nel file | `ready` | true | `authenticated` | `authType: "apiKey"`, `authLabel: "Devin API Key"` (`:1847-1862`) |
| successo senza chiave | `ready` | true | `unknown` | invita a `devin auth login` o a `WINDSURF_API_KEY` (`:1863-1866`) |

La versione si legge con `parseGenericCliVersion` da stdout e stderr (`apps/server/src/provider/Layers/ProviderHealth.ts:1846-1848`).

### Catalogo modelli

- Fonte primaria: `devin models list --format json` lanciato come processo separato, con l'ambiente filtrato del provider (`apps/server/src/provider/Layers/DevinAdapter.ts:1396-1402`). Non c'è scoperta via ACP: la sessione non espone un elenco modelli (`packages/contracts/src/model.ts:1098-1100`).
- `parseDevinCliModelList` prova prima l'output intero, poi la sottostringa tra la prima parentesi e l'ultima chiusura, togliendo il BOM; se nessun candidato è JSON valido torna una lista vuota (`apps/server/src/provider/Layers/DevinAdapter.ts:873-897`).
- `collectDevinModelDescriptors` scende ricorsivamente con un insieme `seen` contro i cicli. Una famiglia con `variants` non viene riattraversata sulle varianti, per non perdere la matrice degli sforzi; le voci piatte con solo `model_uid` restano selezionabili senza controlli (`apps/server/src/provider/Layers/DevinAdapter.ts:825-887`). Una voce senza slug viene scartata (`:797-808`).
- `mergeDevinModelDescriptors` deduplica per slug minuscolo, ricava il nome con `humanizeModelSlug` quando manca, e inferisce dai nomi delle varianti lo sforzo (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), la modalità veloce (`fast`, `lightning`, `priority`) e il toggle di pensiero, che compare solo se esistono sia una variante `thinking` sia una senza (`apps/server/src/provider/Layers/DevinAdapter.ts:973-1060`). Le finestre di contesto compaiono solo se ce n'è più di una (`:989-1001`, `:1050-1055`).
- `source` è `devin-cli` quando il parsing dà almeno un modello, altrimenti `devin.static`; `cached: false` sulla scoperta fresca (`apps/server/src/provider/Layers/DevinAdapter.ts:1432-1440`). Un errore o un elenco vuoto non impediscono il risultato: si torna il catalogo statico con il campo `error` valorizzato e ripulito da `redactAcpLogSecrets` (`:1409-1430`, `:1093-1096`).
- Cache: chiave il percorso binario risolto, validità 5 minuti, al massimo 16 voci con rimozione della più vecchia; una risposta in cache torna con `cached: true`; i risultati con `error` non si mettono in cache (`apps/server/src/provider/Layers/DevinAdapter.ts:689-714`, `:723-733`). Un semaforo serializza le scoperte (`:704`).
- Catalogo statico nei contratti: tre voci, `adaptive`, `swe-1-6`, `swe-1-7`, le ultime due con `supportsFastMode: true` (`packages/contracts/src/model.ts:1101-1129`); predefinito `adaptive` (`packages/contracts/src/model.ts:1142`); alias (`packages/contracts/src/model.ts:1308-1320`). L'adattatore lo importa davvero (`apps/server/src/provider/Layers/DevinAdapter.ts:1063-1080`).
- Comandi slash: sessione ACP usa e getta `Synara Command Discovery`, fino a 500 ms di attesa se l'elenco è vuoto, `source: "devin-acp"`, cache separata con le stesse regole (`apps/server/src/provider/Layers/DevinAdapter.ts:1152-1166`, `:3169-3176`, `:3178-3189`).

### Opzioni

- `DevinModelOptions`: `reasoningEffort`, `fastMode`, `thinking`, `contextWindow`, `modelVariant` (`packages/contracts/src/model.ts:150-160`). `modelVariant` è lo UID concreto che l'avvio passa a `--model`.
- `DevinModelSelection` con `provider: "devin"` (`packages/contracts/src/orchestration.ts:169-174`); opzioni di avvio solo `binaryPath` (`packages/contracts/src/orchestration.ts:228-230`); impostazione `binaryPath` con predefinito `devin` (`packages/contracts/src/settings.ts:74-78`).
- `resolveDevinStartModel` risolve la variante solo se almeno un tratto è richiesto; altrimenti usa direttamente la selezione o il modello configurato, senza avviare la scoperta (`apps/server/src/provider/Layers/DevinAdapter.ts:1152-1182`). La sessione proiettata tiene lo slug della famiglia, non lo UID concreto, perché il reattore non riavvii Devin a ogni turno (`:2071-2076`).
- Modalità per turno: `resolveRequestedModeId` cerca gli alias `plan`/`architect`, `accept-edits`/`code`, `bypass`/`full access` (`apps/server/src/provider/Layers/DevinAdapter.ts:320-322`, `:556-562`). Per il piano vale solo la corrispondenza esatta normalizzata, per gli altri anche quella per parola intera (`:565-570`). Se la modalità non esiste si fallisce, tranne in `full-access` fuori dal piano, dove si lascia stare (`:572-586`). Dopo `setMode` la modalità si rilegge e, se non è quella chiesta, il turno fallisce (`:591-646`).
- In modalità piano il testo riceve il prefisso `DEVIN_PLAN_MODE_PROMPT_PREFIX`, quattro righe che vietano di scrivere file e di fare domande (`apps/server/src/provider/Layers/DevinAdapter.ts:323-328`, `:1116-1123`).
- Ogni `session/prompt` porta `_meta: { mode: "plan" | "agent" }`, idempotente per non invertire lo stato del tracker nativo dopo una riconnessione (`apps/server/src/provider/Layers/DevinAdapter.ts:1084-1092`, `:2820-2823`).

### Capacità dichiarate

Oggetto `capabilities` (`apps/server/src/provider/Layers/DevinAdapter.ts:3434-3438`):

```ts
{ sessionModelSwitch: "restart-session", conversationRollback: "restart-session", supportsRuntimeModelList: true }
```

`getComposerCapabilities` (`apps/server/src/provider/Layers/DevinAdapter.ts:3111-3122`): `supportsSkillMentions: false`, `supportsSkillDiscovery: false`, `supportsNativeSlashCommandDiscovery: true`, `supportsPluginMentions: false`, `supportsPluginDiscovery: false`, `supportsRuntimeModelList: true`, `supportsThreadCompaction: true`, `supportsThreadImport: false`. Metodi esposti: `listCommands`, `compactThread`, `listModels`; mancano `readExternalThread`, `forkThread`, `listPlugins` (`apps/server/src/provider/Layers/DevinAdapter.ts:3448-3452`).

### Ciclo di vita e cursore di ripresa

- Cursore: `{ schemaVersion: 1, sessionId }`; si scarta se la versione è diversa o l'id non è una stringa non vuota (`apps/server/src/provider/Layers/DevinAdapter.ts:160`, `:482-495`, `:2080-2082`).
- Avvio sotto blocco per thread: valida il provider, risolve la cartella, ferma la sessione precedente, apre lo scope, prende la lease del gateway e scrive la configurazione MCP (`apps/server/src/provider/Layers/DevinAdapter.ts:1740-1824`).
- Se si chiedeva una ripresa e l'agente risponde esattamente "failed to load session data", l'errore diventa `ProviderAdapterProcessError` con `reason: "resume-state-unavailable"` (`apps/server/src/provider/Layers/DevinAdapter.ts:2040-2053`).
- Dopo `session/load` Devin può riprodurre la trascrizione: la soppressione resta attiva finché lo stream non è quieto per 200 ms, l'avvio si sblocca dopo 1,5 s e il tetto assoluto di 30 s scrive un avviso `devin.acp.resume_replay_quiet_wait_timeout` (`apps/server/src/provider/Layers/DevinAdapter.ts:1699-1730`, `:2366-2375`). `sendTurn` e `compactThread` aspettano lo stesso `Deferred` (`:2706-2708`, `:3232-3234`).
- Eventi di avvio: `session.started`, `session.state.changed` `ready`, `thread.started` con `providerThreadId` (`apps/server/src/provider/Layers/DevinAdapter.ts:2378-2398`). Un fallimento nella finalizzazione chiude la sessione (`:2400-2404`).
- Turno: rifiuta un invio durante una compattazione, durante un altro avvio di turno e con un turno già attivo (`apps/server/src/provider/Layers/DevinAdapter.ts:2657-2681`). Un prompt vuoto è rifiutato (`:2740-2746`). Il prompt gira in una fibra a parte, con esiti separati per fallimento, successo e interruzione (`:2812-2953`).
- Un fallimento del prompt chiude sempre la sessione, perché il figlio ACP resta inutilizzabile (`apps/server/src/provider/Layers/DevinAdapter.ts:2858-2862`).
- Interruzione: ignora un `turnId` vecchio con un avviso, segna `pendingTurnInterrupted` se il prompt non è ancora partito, chiude approvazioni e domande, invia `session/cancel` e interrompe la fibra del prompt solo se questa non ha già risolto (`apps/server/src/provider/Layers/DevinAdapter.ts:2991-3029`).
- Recupero dai blocchi: il figlio può restare vivo e muto. Il supervisore legge due forme sul suo stderr, `affogato::stall_watch` e un `create_session` che non arriva mai a "waiting for shell ready" (`apps/server/src/provider/Layers/DevinAdapter.ts:172-175`). `evaluateDevinWedgeSignal` è puro e vale solo con un turno attivo e nessuna attesa umana (`:234-265`). Il recupero annulla il turno, riavvia dal cursore e invia il prompt `continue`; il budget è 3 tentativi in 30 minuti per thread, oltre il quale il turno fallisce (`:176-180`, `:2472-2612`). L'utente vince sempre: ogni passo distruttivo ricontrolla lo stato vivo (`:2528-2545`, `:2559-2568`).
- Il turno recuperato si chiude con `stopReason: "synara.devin.wedge-recovery"` invece di `cancelled` (`apps/server/src/provider/Layers/DevinAdapter.ts:2903-2909`, `:2945-2950`).
- Compattazione: `runDevinAcpCompactionCommand` rifiuta con -32601 se l'agente annuncia comandi ma non `compact`, e manda il prompt `/compact` con `_meta: { mode: "agent" }` se l'elenco è vuoto (`apps/server/src/provider/acp/DevinAcpSupport.ts:305-329`). L'esito riuscito emette solo `thread.state.changed` `compacted`; un `stopReason` `cancelled` o un tool fallito contano come fallimento (`apps/server/src/provider/Layers/DevinAdapter.ts:3372-3402`).
- Rollback: sempre errore di validazione, "Devin does not support conversation rollback." (`apps/server/src/provider/Layers/DevinAdapter.ts:3078-3086`).
- Stop: idempotente, rilascia la lease, risolve i `Deferred` in attesa, chiude lo scope ACP e poi pulisce la cartella di configurazione, ed emette `session.exited` con `exitKind: "graceful"` (`apps/server/src/provider/Layers/DevinAdapter.ts:1526-1561`, `:1295-1307`).

### Iniezione degli strumenti host

Devin non usa `buildAcpSynaraMcpServers`: non passa nessun `buildMcpServers` al runtime e non mette `mcpServers` in `session/new`. Il gateway arriva da un file di configurazione.

- `createDevinSessionConfig` legge la configurazione utente da `$XDG_CONFIG_HOME/devin/mcp_config.json` o `%APPDATA%/devin/mcp_config.json` (`apps/server/src/provider/acp/DevinSessionConfig.ts:37-60`). Se `mcpServers` non è un oggetto, o se definisce già il nome riservato `synara`, si fallisce senza toccare niente (`:69-77`).
- Crea una radice temporanea `synara-devin-` con permessi `0700`, vi ricollega con symlink le cartelle `skills` degli spazi `devin` e `cognition` se esistono, e scrive `devin/mcp_config.json` con `mode: 0o600` e `flag: "wx"` (`apps/server/src/provider/acp/DevinSessionConfig.ts:79-130`).
- La voce `synara` è stdio: comando e argomenti del proxy, più `SYNARA_AGENT_GATEWAY_URL`, `SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN` e `ELECTRON_RUN_AS_NODE: "1"` (`apps/server/src/provider/acp/DevinSessionConfig.ts:110-125`; costanti in `apps/server/src/agentGateway/mcpInjection.ts:24-27`). Nel file non finisce mai il bearer di sessione, solo il gettone monouso.
- Il figlio riceve `XDG_CONFIG_HOME` (o `APPDATA` su Windows) puntato alla radice temporanea (`apps/server/src/provider/acp/DevinSessionConfig.ts:134-137`).
- L'adattatore chiede il gettone alla lease e traduce ogni errore in `ProviderAdapterRequestError` su `session/start` (`apps/server/src/provider/Layers/DevinAdapter.ts:1800-1818`). La cartella si cancella allo stop, e un errore di pulizia diventa solo un avviso (`:1295-1307`).
- La politica host di Synara si antepone al primo prompt e solo se la configurazione è stata davvero installata (`apps/server/src/provider/Layers/DevinAdapter.ts:2748-2755`).
- Ogni fine turno annulla le richieste del gateway per quel turno; la lease si rilascia allo stop e all'uscita del processo (`apps/server/src/provider/Layers/DevinAdapter.ts:1917`, `:2836`, `:2868`, `:1533-1534`).

### Eventi d'uso

- `UsageUpdated` registra il costo con `recordAcpSessionCost` e pubblica l'evento di uso token solo con un turno attivo e fuori dal replay (`apps/server/src/provider/Layers/DevinAdapter.ts:2306-2326`).
- `turn.completed` porta `result.usage` se presente e il costo finale del turno (`apps/server/src/provider/Layers/DevinAdapter.ts:2925-2930`).
- Un turno chiuso senza contenuto assistente e senza `cancelled` scrive l'avviso `devin.acp.turn_completed_without_content` (`apps/server/src/provider/Layers/DevinAdapter.ts:2884-2891`).
- Un `AssistantItemCompleted` per un elemento che non ha mai avuto contenuto non viene emesso (`apps/server/src/provider/Layers/DevinAdapter.ts:2162-2192`); una delta di solo ragionamento o di soli spazi non conta come contenuto (`:654-660`).
- Un `ToolCallUpdated` già mappato su un turno precedente resta su quel turno e non può sporcare lo stato di fallimento del turno corrente; la provenienza si pota a un solo turno indietro (`apps/server/src/provider/Layers/DevinAdapter.ts:1218-1246`, `:2216-2242`).
- Il timeout di inattività emette `turn.completed` `failed` con "Devin stopped responding (no activity for Ns); the turn was timed out.", forka il `session/cancel` senza attenderlo e interrompe la fibra del prompt (`apps/server/src/provider/Layers/DevinAdapter.ts:2413-2462`).

### Casi limite dai test

- `apps/server/src/provider/Layers/DevinAdapter.test.ts:326` (treats zero as an explicit disable and passes positive values through)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:372` (fires the spawn-stall signal for the oldest un-ready spawn)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:407` (forgets recoveries that fell out of the rolling window)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:492` (recovers a spawn-stall wedge when a command never reaches shell-ready)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:554` (fails the turn instead of recovering once the thread budget is exhausted)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:704` (honors user cancellation while the recovery cancel notification is pending)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:755` (leaves no session when the recovery restart itself fails)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:822` (rejects an overlapping send without replacing the active turn)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:870` (keeps tool budget for every active tool and ignores terminal regressions)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:909` (does not let stale prior-turn tool updates refresh or extend the current turn)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1020` (clears active tool budget on normal settlement, interrupt, timeout, and teardown)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1090` (does not touch config options for the model selection)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1106` (fails closed when plan mode is not available)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1178` (rejects ambiguous partial mode matches)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1205` (maps approval-required to Code in the real Devin 3000.6.7 catalog)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1226` (keeps Plan precedence and never maps approval-required to Smart or Ask)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1393` (coalesces concurrent model discovery through the shared lock)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1434` (rejects requested traits that have no concrete model variant)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1591` (recognizes SWE lightning as a fast variant)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1697` (returns no descriptors for non-JSON CLI output)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1721` (routes same-turn updates to the active turn and suppresses during replay)
- `apps/server/src/provider/Layers/DevinAdapter.test.ts:1787` (closes the ACP scope before config cleanup and contains cleanup failure)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:184` (normalizes one get_output request split across byte chunks)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:315` (preserves an invalid line while normalizing the following valid JSON line)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:407` (keeps non-boolean block values for strict validation)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:474` (uses the scoped config environment without placing secrets in args)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:579` (uses the canonical headless method when Devin only advertises browser auth)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:627` (fails the production validator early with interactive-only login guidance)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:817` (refuses to attach the API key when the server URL is rejected)
- `apps/server/src/provider/acp/DevinAcpSupport.test.ts:903` (fails clearly when Devin advertises commands without /compact)
- `apps/server/src/provider/acp/DevinSessionConfig.test.ts:70` (contains no session bearer and uses owner-only POSIX permissions)
- `apps/server/src/provider/acp/DevinSessionConfig.test.ts:79` (rejects a reserved synara collision without changing user config)

### In Trama

Devin diventa un profilo del client ACP condiviso, con due pezzi propri: la configurazione MCP su disco e il supervisore dei blocchi.

```swift
struct DevinACPProfile: ACPProviderProfile {
    let kind: ProviderKind = .devin
    func spawn(settings: DevinSettings, cwd: URL, config: DevinSessionConfig?) -> ACPSpawn // acp, --model <uid>
    func resolveAuthMethod(_ initialize: ACPInitializeResult, apiKey: String?) throws -> String
    func authenticateMeta(credentials: DevinCredentials?) throws -> [String: JSONValue] // headless, api_key, api_server_url
    var authPolicy: ACPAuthPolicy { .onDemand }
    func validateInitialize(_ initialize: ACPInitializeResult) throws
    func normalizeIncoming(_ message: JSONValue) -> JSONValue // toglie get_output.arguments.block
    func applyMode(interaction: InteractionMode, runtime: RuntimeMode, on session: ACPSession) async throws
}
```

- `DevinAdapter` (attore Swift) tiene per thread il `DevinSessionContext`: turno attivo, ciclo di vita degli strumenti per il budget di inattività, provenienza dei tool call di un solo turno indietro, `sessionConfigReady` e `resumeReplayReady` come continuation.
- `DevinSessionConfig` diventa un tipo con `deinit` o una pulizia esplicita: cartella temporanea `0o700`, JSON scritto con `O_EXCL` e `0o600`, `XDG_CONFIG_HOME` nel figlio. In Swift i symlink verso `skills` si fanno con `FileManager.createSymbolicLink`.
- Credenziali: `parseDevinCredentialsToml` e `validateDevinApiServerUrl` sono funzioni pure, provate con gli stessi casi; l'URL si valida con `URLComponents` e un controllo di loopback.
- Catalogo: attore `DevinModelDiscovery` che lancia `devin models list --format json`, parser tollerante su `JSONValue`, cache LRU da 16 voci per 5 minuti, ripiego sul catalogo statico dei contratti con il campo `error`.
- Recupero dai blocchi: `evaluateDevinWedgeSignal` e `canRecoverDevinWedge` restano funzioni pure; il supervisore è un `Task` con un `Clock` iniettato, e il tap su stderr è un `AsyncStream<String>` di righe.
- Stato di accesso: stessa tabella, con `devin --version` e timeout di 4 s, più la lettura del file di credenziali.

### Da non portare

- Variabili di debug `SYNARA_DEVIN_ACP_DEBUG` e l'eredità `DP_DEVIN_ACP_DEBUG`, con il marcatore `devin-acp-meta-stripper-v2` e il mirroring dei payload che contengono `devinShell` (`apps/server/src/provider/Layers/DevinAdapter.ts:284-287`, `:1845-1851`).
- Il logger NDJSON nativo (`apps/server/src/provider/Layers/DevinAdapter.ts:1836-1844`).
- I rami Windows: percorsi `devin.exe` sotto LocalAppData, `%APPDATA%` per credenziali e configurazione MCP, junction al posto dei symlink (`apps/server/src/provider/acp/DevinAcpSupport.ts:136-139`, `:211-213`; `apps/server/src/provider/acp/DevinSessionConfig.ts:38-41`, `:101`, `:136`).
- La meccanica Effect di fibre, scope e `forkIn`, che in Swift diventa concorrenza strutturata (`apps/server/src/provider/Layers/DevinAdapter.ts:2342-2345`, `:2950-2953`).

### Non trovato

- Un uso di `buildAcpSynaraMcpServers` o di `buildMcpServers` per Devin: `grep -n "mcpServers\|buildMcpServers"` su `Layers/DevinAdapter.ts` non trova nulla. L'MCP passa solo dal file di `DevinSessionConfig.ts`.
- Fork nativo: nessun `forkViaAcpRuntime`, `session/fork` o `forkThread` in `Layers/DevinAdapter.ts`. Cercati anche `readExternalThread` e `listPlugins`, assenti.
- Chiamate a `setModel` o `setConfigOption` da parte dell'adattatore: il modello si fissa a `--model` all'avvio del processo e la modalità passa da `setMode`. Cercati entrambi i nomi in `Layers/DevinAdapter.ts`.
- Un aggiornamento nativo per Devin: nessuna voce `devin` in `PACKAGE_MANAGED_PROVIDER_UPDATES` (`apps/server/src/provider/Layers/ProviderHealth.ts:188-289`).
- Un `authStatus: "unauthenticated"` per Devin: il controllo produce solo `unknown` o `authenticated`. Cercato `unauthenticated` nella parte Devin di `ProviderHealth.ts`.
- Il valore di `DEVIN_WEDGE_SUPERVISOR_INTERVAL_MS` come variabile d'ambiente: è una costante fissa a 5000 ms senza override (`apps/server/src/provider/Layers/DevinAdapter.ts:181`, `:226`).
- Un test di ciclo di vita completo che copra l'autenticazione on-demand con un trasporto finto: `DevinAcpSupport.test.ts:493` prova solo la scelta della politica sul percorso di produzione.
