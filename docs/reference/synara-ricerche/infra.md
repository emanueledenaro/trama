## NN. Infrastruttura comune dei provider

Ticket: V08 (usata da P02-P09).

Questa sezione entra nel dettaglio di ciò che la sezione 5 riassume: il registro, la conformità e la cache dello stato. Qui si trovano i numeri, i formati su disco e gli algoritmi.

### Percorsi dei file

| Cosa | File |
| --- | --- |
| Interfaccia adattatore | `apps/server/src/provider/Services/ProviderAdapter.ts` |
| Controllo di conformità | `apps/server/src/provider/providerAdapterConformance.ts` (+`.test.ts`) |
| Cache dello stato su disco | `apps/server/src/provider/providerStatusCache.ts` (+`.test.ts`) |
| Uso della cache dello stato | `apps/server/src/provider/Layers/ProviderHealth.ts` |
| Cache dei modelli | `apps/server/src/provider/providerModelDiscoveryCache.ts` (+`.test.ts`) |
| Istradamento della scoperta | `apps/server/src/provider/Layers/ProviderDiscoveryService.ts` (+`.test.ts`) |
| Directory delle sessioni | `apps/server/src/provider/Services/ProviderSessionDirectory.ts`, `Layers/ProviderSessionDirectory.ts` (+`.test.ts`) |
| Persistenza dei legami | `apps/server/src/persistence/Services/ProviderSessionRuntime.ts`, `apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts` |
| Riconciliazione | `apps/server/src/provider/providerRuntimeReconciliation.ts`, `Layers/ProviderRuntimeReconciler.ts` (+`.test.ts`) |
| Chiusura delle sessioni inattive | `apps/server/src/provider/Layers/ProviderSessionReaper.ts`, `Services/ProviderSessionReaper.ts` (+`.test.ts`) |
| Facciata e istradamento | `apps/server/src/provider/Layers/ProviderService.ts`, `Services/ProviderService.ts` |

### Interfaccia dell'adattatore e capacità

`ProviderAdapterCapabilities` ha dieci campi al commit attuale (`Services/ProviderAdapter.ts:70-86`):

| Campo | Tipo | Riga |
| --- | --- | --- |
| `sessionModelSwitch` | `ProviderSessionModelSwitchMode` (obbligatorio) | `Services/ProviderAdapter.ts:74` |
| `conversationRollback` | `"native" \| "restart-session"` opzionale | `Services/ProviderAdapter.ts:76` |
| `supportsSkillMentions` | `boolean?` | `Services/ProviderAdapter.ts:77` |
| `supportsSkillDiscovery` | `boolean?` | `Services/ProviderAdapter.ts:78` |
| `supportsNativeSlashCommandDiscovery` | `boolean?` | `Services/ProviderAdapter.ts:79` |
| `supportsPluginMentions` | `boolean?` | `Services/ProviderAdapter.ts:80` |
| `supportsPluginDiscovery` | `boolean?` | `Services/ProviderAdapter.ts:81` |
| `supportsRuntimeModelList` | `boolean?` | `Services/ProviderAdapter.ts:82` |
| `supportsTurnSteering` | `boolean?` | `Services/ProviderAdapter.ts:83` |
| `supportsLiveTurnDiffPatch` | `boolean?` | `Services/ProviderAdapter.ts:85` |

`sessionModelSwitch` è l'unico campo obbligatorio. Il tipo di rollback è definito a `Services/ProviderAdapter.ts:68`. `ProviderAdapterShape` parte da `Services/ProviderAdapter.ts:99` e porta `provider` e `capabilities` a `103-104`. Il buffer degli eventi runtime dell'adattatore è 2048 voci (`Services/ProviderAdapter.ts:55`).

Nota: i flag chiesti dal ticket V08 (thread persistente, ripresa, strumenti host, override per turno, uso token) non esistono in questa struttura. Va detto esplicitamente che sono un progetto di Trama, non un porting.

### Capacità dichiarate dai nove adattatori

`s.m.s.` = `sessionModelSwitch`, `roll.` = `conversationRollback`. Una cella vuota significa campo assente, cioè `undefined`.

| Provider | s.m.s. | roll. | skillMent. | skillDisc. | slashDisc. | pluginMent. | pluginDisc. | modelList | steering | diffPatch | File:riga |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex | in-session | | sì | sì | no | sì | sì | sì | sì | sì | `Layers/CodexAdapter.ts:2467-2477` |
| Claude | in-session | restart-session | no | no | sì | no | no | sì | sì | no | `Layers/ClaudeAdapter.ts:6959-6970` |
| Cursor | in-session | | | | | | | sì | | | `Layers/CursorAdapter.ts:1888-1891` |
| Antigravity | restart-session | restart-session | | | | | | sì | | no | `Layers/AntigravityAdapter.ts:2764-2769` |
| Grok | restart-session | | | | | | | | | | `Layers/GrokAdapter.ts:2599-2601` |
| Droid | restart-session | restart-session | | | | | | | | | `Layers/DroidAdapter.ts:2213-2216` |
| OpenCode | in-session | | | | sì | | | sì | | | `Layers/OpenCodeAdapter.ts:4563-4567` |
| Pi | in-session | | sì | sì | sì | no | no | sì | sì | | `Layers/PiAdapter.ts:3255-3264` |
| Devin | restart-session | restart-session | | | | | | sì | | | `Layers/DevinAdapter.ts:3434-3438` |

Da leggere insieme al controllo di conformità: Cursor espone `listSkills` e `listModels` (`Layers/CursorAdapter.ts:1903-1904`) pur non dichiarando `supportsSkillDiscovery`, e Grok espone `listModels` (`Layers/GrokAdapter.ts:2614`) senza dichiarare `supportsRuntimeModelList`. Il controllo verifica solo il verso flag → metodo, mai il contrario.

### Controllo di conformità

`providerAdapterConformance.ts` fa due cose.

Undici metodi sono obbligatori per ogni adattatore (`providerAdapterConformance.ts:46-58`): `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `stopSession`, `listSessions`, `hasSession`, `readThread`, `rollbackThread`, `stopAll`.

Cinque coppie flag/metodo, elenco completo (`providerAdapterConformance.ts:60-69`):

| Capacità | Metodi richiesti | Riga |
| --- | --- | --- |
| `supportsTurnSteering` | `steerTurn` | `providerAdapterConformance.ts:64` |
| `supportsSkillDiscovery` | `listSkills` | `providerAdapterConformance.ts:65` |
| `supportsNativeSlashCommandDiscovery` | `listCommands` | `providerAdapterConformance.ts:66` |
| `supportsPluginDiscovery` | `listPlugins` e `readPlugin` | `providerAdapterConformance.ts:67` |
| `supportsRuntimeModelList` | `listModels` | `providerAdapterConformance.ts:68` |

Cinque campi restano fuori dal controllo per costruzione (`providerAdapterConformance.ts:6-13`): `sessionModelSwitch`, `conversationRollback`, `supportsSkillMentions`, `supportsPluginMentions`, `supportsLiveTurnDiffPatch`. Sono dichiarazioni di comportamento, non legate a un metodo.

Il confronto è `!== true` (`providerAdapterConformance.ts:81`): solo il valore vero esatto attiva il requisito. I problemi si accumulano tutti e vengono uniti in un solo messaggio (`providerAdapterConformance.ts:116-123`), con due formati: `<flag> requires <metodo>()` e `required method <metodo>() is missing`. `providerAdapterRegistrationIssues` rileva a parte il provider registrato due volte (`providerAdapterConformance.ts:96-108`), riportando l'indice del duplicato.

### Cache dello stato su disco

Un file JSON per provider, uno stato per file: `${stateDir}/provider-status/${provider}.json` (`providerStatusCache.ts:41-46`). Lo `stateDir` è `baseDir/userdata` in produzione e `baseDir/dev` con un `devUrl` (`apps/server/src/config.ts:146`).

Il contenuto è un `ServerProviderStatus` serializzato con rientro di due spazi più un newline finale (`providerStatusCache.ts:80-83`). La scrittura passa da `writeFileStringAtomically`, quindi file temporaneo e rinomina, con modo `0o600` per difetto (`apps/server/src/atomicWrite.ts:88-96`, `apps/server/src/privatePathPermissions.ts:13`).

La lettura è volutamente indulgente (`providerStatusCache.ts:50-74`): file assente o vuoto danno `undefined`, un JSON non valido produce un avviso "failed to parse provider status cache, ignoring" e ancora `undefined`. Lo schema è `Schema.fromJsonString(ServerProviderStatus)` (`providerStatusCache.ts:25-27`).

`orderProviderStatuses` impone un ordine fisso dei nove provider (`providerStatusCache.ts:13-23`, `34-39`): codex, claudeAgent, cursor, antigravity, grok, droid, devin, opencode, pi. Un provider fuori elenco finisce in fondo (`providerStatusCache.ts:29-32`).

Quando si legge: una sola volta, alla costruzione del layer `ProviderHealth` (`Layers/ProviderHealth.ts:2091-2107`). I percorsi sono precalcolati per i nove provider a `Layers/ProviderHealth.ts:2078-2089`, l'elenco è a `Layers/ProviderHealth.ts:132-142`. Le letture sono concorrenti, gli `undefined` e le voci di provider disattivato vengono filtrati, e il risultato diventa lo stato iniziale in memoria (`Layers/ProviderHealth.ts:2109`). Così la schermata mostra qualcosa subito, senza attendere le sonde CLI.

Quando si scrive: solo dentro un refresh e solo se lo stato proiettato è cambiato (`Layers/ProviderHealth.ts:2442-2446`). `persistStatuses` toglie `updateState` prima di serializzare (`Layers/ProviderHealth.ts:2388-2404`), scrive i nove file in concorrenza e ignora gli errori dopo averli registrati.

Un solo controllo alla volta: `ensureRefreshFiber` tiene un fiber condiviso in un `Ref` (`Layers/ProviderHealth.ts:2113`, `2451-2498`). Chi arriva durante un refresh si aggancia a quello in corso. Il flag `refreshNeedsFollowUpRef` (`Layers/ProviderHealth.ts:2114`) è il "serve un altro giro": viene alzato quando le impostazioni cambiano a metà refresh (`Layers/ProviderHealth.ts:2426`) e consumato una volta alla fine del ciclo (`2463-2466`) e una volta nel finalizzatore, che pianifica un refresh ritardato (`2477-2492`). I cambiamenti si pubblicano su una `PubSub` non limitata (`Layers/ProviderHealth.ts:2071-2074`, `2446`).

### Cache dei modelli

Verifica dei cinque numeri del ticket, tutti confermati nel codice:

| Ticket | Costante | Valore nel codice | Riga |
| --- | --- | --- | --- |
| fresco 10 minuti | `PROVIDER_MODEL_DISCOVERY_FRESH_TTL_MS` | `10 * 60_000` | `providerModelDiscoveryCache.ts:18` |
| vecchio 24 ore | `PROVIDER_MODEL_DISCOVERY_STALE_TTL_MS` | `24 * 60 * 60_000` | `providerModelDiscoveryCache.ts:24` |
| ripetizione del fallimento 30 secondi | `PROVIDER_MODEL_DISCOVERY_FAILURE_TTL_MS` | `30_000` | `providerModelDiscoveryCache.ts:30` |
| timeout 45 secondi | `PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS` | `45_000` | `providerModelDiscoveryCache.ts:36` |
| 64 voci | `PROVIDER_MODEL_DISCOVERY_CACHE_MAX_ENTRIES` | `64` | `providerModelDiscoveryCache.ts:37` |

Tutti e cinque sono sovrascrivibili dalle opzioni della fabbrica (`providerModelDiscoveryCache.ts:99-112`), cosa che i test usano.

Chiave. Cinque campi: `provider`, `binaryPath`, `apiEndpoint`, `agentDir`, `cwd`, con `null` al posto di `undefined` (`providerModelDiscoveryCache.ts:39-45`, `75-85`). La forma serializzata è un array JSON di cinque elementi (`providerModelDiscoveryCache.ts:87-88`), quindi due repository diversi o due binari diversi non condividono mai un catalogo.

Tre mappe separate: cataloghi, fallimenti, voli in corso (`providerModelDiscoveryCache.ts:114-116`).

Algoritmo di `lookup` (`providerModelDiscoveryCache.ts:224-249`):

1. Legge il catalogo scartando quello più vecchio di 24 ore (`118-126`) e il fallimento più vecchio di 30 secondi (`128-136`).
2. Catalogo entro i 10 minuti: risposta immediata con `cached: true`, nessuna chiamata all'adattatore (`231-233`).
3. Catalogo oltre i 10 minuti ma entro le 24 ore: risposta immediata con `cached: true` e riconvalida in sottofondo, che però si salta se esiste un fallimento recente per la stessa chiave (`234-238`).
4. Nessun catalogo e un volo già in corso: si attende quello (`240-243`).
5. Nessun catalogo, nessun volo, un fallimento recente: si ripete quell'esito senza toccare l'adattatore (`244-246`).
6. Altrimenti si avvia la scoperta e si attende (`247-248`).

Volo singolo (`providerModelDiscoveryCache.ts:182-214`). Un solo `Deferred` per chiave; la scoperta gira su un fiber staccato con `Effect.forkDetach` (`212`), così il client che si disconnette non annulla il lavoro che altri stanno attendendo. Il timeout è applicato dentro il volo (`193`) e la scadenza diventa un `ProviderAdapterRequestError` con metodo `models/list` e testo `Model discovery timed out after 45s.` (`196-203`).

Cosa si memorizza (`providerModelDiscoveryCache.ts:163-175`). Solo un catalogo non vuoto e senza `error` è "buono" (`96-97`). Una risposta vuota ma senza errore è autorevole: il catalogo precedente viene cancellato e l'esito registrato tra i fallimenti (`169-174`), così i modelli rimossi dal provider non restano nel selettore. I ripieghi statici che portano `error` valgono come fallimento breve.

Sfratto. I cataloghi si reinseriscono a ogni scrittura per usare l'ordine di iterazione della `Map` come ordine LRU, poi si tolgono i più vecchi finché la dimensione rientra in 64 (`providerModelDiscoveryCache.ts:138-148`). Stessa potatura sui fallimenti (`150-161`). `size()` conta solo i cataloghi (`257`).

Chi la usa: una sola istanza per layer di scoperta (`Layers/ProviderDiscoveryService.ts:101`), applicata dentro `listModels` (`Layers/ProviderDiscoveryService.ts:295-303`). Prima della cache ci sono due uscite anticipate: provider disattivato dà `{ models: [], source: "disabled", cached: false }` (`Layers/ProviderDiscoveryService.ts:279-285`) e adattatore senza `listModels` dà `source: "unsupported"` (`287-293`). La chiamata all'adattatore è avvolta in `Effect.suspend` perché l'adattatore venga toccato solo su un vero buco (`Layers/ProviderDiscoveryService.ts:298`), e le voci malformate si isolano dopo (`300-301`). Nessuna cache analoga per `listAgents` (`Layers/ProviderDiscoveryService.ts:306-329`).

### Directory delle sessioni

L'interfaccia è in `Services/ProviderSessionDirectory.ts`. Il record `ProviderRuntimeBinding` ha nove campi (`Services/ProviderSessionDirectory.ts:15-25`): `threadId` e `provider` obbligatori, poi `adapterKey`, `status`, `lifecycleGeneration`, `lastSeenAt`, `resumeCursor`, `runtimePayload`, `runtimeMode`. Sei operazioni: `upsert`, `getProvider`, `getBinding`, `remove`, `listThreadIds`, `listBindings` (`Services/ProviderSessionDirectory.ts:33-59`).

La persistenza è una riga per thread. Lo schema è `ProviderSessionRuntime` (`apps/server/src/persistence/Services/ProviderSessionRuntime.ts:19-29`): `threadId`, `providerName`, `adapterKey`, `runtimeMode`, `status`, `lifecycleGeneration`, `lastSeenAt` ISO, `resumeCursor` e `runtimePayload` entrambi `NullOr(Unknown)`. La tabella SQLite è `provider_session_runtime` con `thread_id` come chiave primaria e i due campi JSON come colonne di testo (`apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts:8-18`); `lifecycle_generation` arriva con la migrazione 059. Gli stati ammessi sono quattro: `starting`, `running`, `stopped`, `error` (`packages/contracts/src/orchestration.ts:2472-2477`). `list()` restituisce le righe in ordine crescente di ultimo contatto (`apps/server/src/persistence/Services/ProviderSessionRuntime.ts:60-66`).

Regole di `upsert` (`Layers/ProviderSessionDirectory.ts:92-132`): `lastSeenAt` è sempre ora (`106`, `121`); un cambio di provider azzera i campi ereditati, perché `compatibleRuntime` diventa `undefined` (`107-109`) e `adapterKey` torna al nome del nuovo provider (`114-116`); i valori per difetto sono `runtimeMode: "full-access"`, `status: "running"`, `lifecycleGeneration: "legacy"` (`117-120`); il cursore di ripresa si conserva a meno che il chiamante non ne passi uno (`122-125`); il `runtimePayload` si fonde campo per campo quando entrambe le parti sono oggetti, altrimenti si sostituisce (`40-51`, `126-129`).

Un provider persistito ma sconosciuto non fa fallire la lettura: `getBinding` lo tratta come "nessun legame" e registra un debug (`Layers/ProviderSessionDirectory.ts:77-86`), `listBindings` lo salta (`Layers/ProviderSessionDirectory.ts:182-188`). `getProvider` invece fallisce con `No persisted provider binding found for thread '<id>'.` (`Layers/ProviderSessionDirectory.ts:140-145`).

`ProviderService` usa la directory come tabella di istradamento: risolve il provider dal thread e poi chiede l'adattatore al registro, per esempio a `Layers/ProviderService.ts:1441`, `1483`, `1685`, `2795`.

### Riconciliazione

`planProviderRuntimeReconciliation` è una funzione pura (`providerRuntimeReconciliation.ts:185-374`) che confronta tre fonti: le sessioni vive dell'adattatore, i legami durevoli della directory e la proiezione della UI. Produce quattro tipi di piano (`providerRuntimeReconciliation.ts:34-68`): `align-running-turn`, `settle-interrupted`, `settle-terminal-projection`, `settle-error`.

Due soglie: staleness a 15 secondi (`providerRuntimeReconciliation.ts:22`) e abbandono a 45 minuti (`providerRuntimeReconciliation.ts:32`). Il piano è pianificato ogni 5 secondi dal layer (`Layers/ProviderRuntimeReconciler.ts:41`, `294`).

L'età considerata è la più recente fra il timestamp della sessione e quello del thread (`providerRuntimeReconciliation.ts:135-148`), quindi un turno che sta davvero scrivendo non diventa mai stantio. Un thread è "abbandonato" solo se sia il ciclo di vita sia l'attività superano i 45 minuti (`providerRuntimeReconciliation.ts:226-228`).

Tre freni contro il falso positivo, tutti scavalcati dall'abbandono: nessun legame e thread figlio nativo (`233`), pompa degli eventi non sana (`259-260`), journal runtime con righe non ancora ingerite (`265`). Il principio dichiarato nel commento è non inventare mai un completamento riuscito: in caso ambiguo si chiude come interrotto.

Il caso di errore non attribuisce mai un errore del provider a un turno diverso da quello proiettato (`providerRuntimeReconciliation.ts:301-318`) e rifiuta un messaggio vuoto, usando `Provider runtime reported an error while reconciling a stale turn.` come ultima risorsa (`322-325`).

Gli id di turno vuoti sono trattati come assenti dappertutto, tramite `turnIdOrNull` (`providerRuntimeReconciliation.ts:83-86`).

### Chiusura delle sessioni inattive

Due valori esatti (`Layers/ProviderSessionReaper.ts:11-12`): soglia di inattività 30 minuti (`30 * 60 * 1000`), intervallo di spazzata 5 minuti (`5 * 60 * 1000`). Entrambi sono sovrascrivibili e passano per un `Math.max(1, ...)` (`Layers/ProviderSessionReaper.ts:25-29`).

La spazzata (`Layers/ProviderSessionReaper.ts:31-74`) scorre tutti i legami e salta: quelli già `stopped` (`43`), quelli senza `lastSeenAt` (`44`), quelli con data non analizzabile (con avviso, `46-54`), quelli inattivi da meno della soglia (`57`) e quelli il cui thread ha ancora un turno attivo nella proiezione (`59-62`). Il resto viene chiuso con `stopRuntimeSession`, e un errore di chiusura diventa un avviso invece di fermare il giro (`64-72`). Se `stopRuntimeSession` non è disponibile la spazzata si salta con un avviso (`32-37`). Il ciclo gira con `Schedule.spaced` dentro un fiber di scope (`84-87`). L'interfaccia è un solo metodo `start()` (`Services/ProviderSessionReaper.ts:3-5`).

### Versioni minime e risoluzione degli eseguibili

`cliVersion.ts` è il confronto condiviso: estrazione con `CLI_VERSION_PATTERN` (`cliVersion.ts:1`), normalizzazione che completa `x.y` in `x.y.0` (`cliVersion.ts:21-33`) e confronto semver con prerelease, dove l'assenza di prerelease vince (`cliVersion.ts:51-74`).

`probeProviderCliVersion` classifica la sonda in cinque esiti: `missing`, `failure`, `timeout`, `nonzero`, `success` (`providerCliVersionProbe.ts:5-31`). Il comando assente è distinto da un errore qualunque tramite `isCommandMissingCause` (`providerCliVersionProbe.ts:21-23`).

Versioni minime trovate nel codice, tre provider su nove:

| Provider | Costante | Valore | Riga |
| --- | --- | --- | --- |
| Codex | `MINIMUM_CODEX_CLI_VERSION` | `0.37.0` | `codexCliVersion.ts:9` |
| Codex, modalità auto | `MINIMUM_CODEX_AUTO_REVIEW_CLI_VERSION` | `0.124.0` | `codexCliVersion.ts:11` |
| Codex, `excludeTurns` | `MINIMUM_CODEX_EXCLUDE_TURNS_CLI_VERSION` | `0.125.0` | `codexCliVersion.ts:13` |
| Claude, modalità auto | `MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION` | `2.1.111` | `claudeCliVersion.ts:4` |
| Antigravity | `MINIMUM_ANTIGRAVITY_CLI_VERSION` | `1.0.12` | `Layers/ProviderHealth.ts:130` |

Cursor, Grok, Droid, OpenCode, Pi e Devin non hanno una versione minima dichiarata. I due valori Codex più alti non bloccano l'avvio, gatteggiano funzioni (`apps/server/src/codexAppServerManager.ts:698-699`). Il messaggio di aggiornamento di Codex è a `codexCliVersion.ts:81`, quello di Antigravity a `Layers/ProviderHealth.ts:1551`.

`providerBinaryResolution.ts` cerca l'eseguibile su PATH con i candidati di piattaforma (`providerBinaryResolution.ts:32-41`) e, solo su Windows, dentro `LOCALAPPDATA` o `USERPROFILE\AppData\Local` (`providerBinaryResolution.ts:43-61`).

### Altri servizi comuni

- `Layers/ProviderService.ts` (3307 righe) è la facciata: risolve l'adattatore per thread dalla directory e lo chiede al registro, e traccia la ripresa. Dopo un avvio riuscito calcola `nativeResumeAttempted` e `nativeResumeSucceeded` chiedendo all'adattatore `didResumeSession`, che vale vero per difetto se il metodo manca (`Layers/ProviderService.ts:1860-1864`). Il "prior transcript bootstrap" è un booleano persistito nel `runtimePayload` sotto la chiave `priorTranscriptBootstrapPending` (`Layers/ProviderService.ts:215`, `1884-1888`), vero quando la ripresa nativa non è riuscita ma la cronologia locale esiste (`1865-1869`). L'esito dell'avvio lo riporta al chiamante (`Services/ProviderService.ts:57-61`).
- `providerLifecycleCoordinator.ts` serializza le mutazioni del ciclo di vita per thread e dà a ognuna una generazione unica. La generazione pubblicata è provvisoria finché la corsa non chiama `commit()`, `adopt()` o `retire()` (`providerLifecycleCoordinator.ts:7-24`). `runCurrentUrgent` attende il lock al massimo 5 secondi con polling ogni 25 ms, poi procede senza (`providerLifecycleCoordinator.ts:35-45`, `50-52`).
- `providerStartupLifecycle.ts` rende esplicite otto fasi di avvio e sette motivi di fallimento (`providerStartupLifecycle.ts:8-25`), con durata per fase (`122-134`) e classificazione che mette l'eseguibile mancante davanti alle euristiche sul messaggio (`170`, `177-188`).
- `providerRuntimeEventIngress.ts` limita la coda dei callback: 32 MB di buffer, 64 posti riservati agli eventi terminali, 512 kB per evento (`providerRuntimeEventIngress.ts:3-5`). Gli eventi terminali sono elencati a `providerRuntimeEventIngress.ts:12-24`.
- `providerRuntimeEventPump.ts` sorveglia `streamEvents`: riprova lo stesso evento finché non viene elaborato, con attesa da 25 ms a 2 secondi (`providerRuntimeEventPump.ts:18-19`), e guarisce dallo stato `degraded` dopo 100 elaborazioni riuscite consecutive (`providerRuntimeEventPump.ts:26`). Gli stati sono `starting`, `healthy`, `recovering`, `degraded` (`Services/ProviderService.ts:43`).
- `providerRuntimeEventIdentity.ts` dà id distinti agli eventi derivati dalla stessa notifica nativa, nella forma `<eventId>:<tipo>:<ordinale>`, e lascia intatti quelli unici (`providerRuntimeEventIdentity.ts:8-27`).
- `supervisedProcessTeardown.ts` è solo una riesportazione: la logica sta in `apps/server/src/platform/supervisedProcessTeardown.ts` (`supervisedProcessTeardown.ts:1-2`).
- `settleConcurrentTeardowns.ts` avvia tutte le chiusure in concorrenza, attende che ognuna si sia posata e solo dopo riporta il primo fallimento (`settleConcurrentTeardowns.ts:5-19`).
- `keyedLock.ts` serializza il lavoro per chiave con una catena FIFO di `Deferred` e cancella la voce quando l'ultimo utente esce; un attendente interrotto lascia il suo nodo agganciato al predecessore, così nessuno scavalca chi tiene il lock (`keyedLock.ts:18-74`).
- `enabledProviderAdapter.ts` nega l'adattatore di un provider disattivato prima di consegnarlo, con errore HTTP 409 e messaggio `<Nome> is disabled in Settings > Providers.` (`enabledProviderAdapter.ts:14-30`, `32-40`).
- `unmappedProviderEvents.ts` ripulisce e limita gli eventi non mappati: 16 000 caratteri per il JSON dei dati (`unmappedProviderEvents.ts:5`), 500 per il dettaglio, 200 per il tipo nativo, 2000 per l'anteprima, profondità 64 (`unmappedProviderEvents.ts:7-10`), con redazione di cookie, credenziali in URL e assegnazioni di segreti (`unmappedProviderEvents.ts:21-27`) e un cancello che limita i messaggi ripetuti a 128 combinazioni (`unmappedProviderEvents.ts:542`).
- `Layers/EventNdjsonLogger.ts` scrive log di osservabilità per thread su tre flussi (`native`, `canonical`, `orchestration`, riga 27), con rotazione a 10 MB e 10 file e finestra di raggruppamento di 200 ms (`Layers/EventNdjsonLogger.ts:21-23`). I fallimenti diventano avvisi e non toccano il comportamento del runtime (`Layers/EventNdjsonLogger.ts:1-7`).

### Casi limite dai test

- `providerStatusCache.test.ts:26` scrive e rilegge uno stato, e verifica il modo `0o600` fuori da Windows.
- `providerStatusCache.test.ts:54` ignora un file di cache malformato invece di fallire.
- `providerStatusCache.test.ts:77` mantiene l'ordine dei provider stabile per il trasporto.
- `providerModelDiscoveryCache.test.ts:47` serve un catalogo fresco senza rieseguire la scoperta.
- `providerModelDiscoveryCache.test.ts:67` serve subito un catalogo vecchio e riconvalida in sottofondo.
- `providerModelDiscoveryCache.test.ts:96` unisce in un solo volo le scoperte concorrenti sulla stessa chiave.
- `providerModelDiscoveryCache.test.ts:155` non riusa un catalogo con un `binaryPath` diverso.
- `providerModelDiscoveryCache.test.ts:172` ripete brevemente un fallimento invece di riavviare la scoperta.
- `providerModelDiscoveryCache.test.ts:194` ripete brevemente anche i cataloghi che portano `error`.
- `providerModelDiscoveryCache.test.ts:262` sostituisce un catalogo vecchio con una risposta vuota autorevole e la ripete brevemente.
- `providerModelDiscoveryCache.test.ts:293` fallisce con un errore di richiesta oltre il tetto del timeout.
- `providerModelDiscoveryCache.test.ts:310` completa la scoperta per gli altri attendenti quando il primo chiamante viene interrotto.
- `providerModelDiscoveryCache.test.ts:332` sfratta i cataloghi meno recenti oltre `maxEntries`.
- `providerAdapterConformance.test.ts:34` pretende `steerTurn` quando lo steering è dichiarato.
- `providerAdapterConformance.test.ts:50` pretende entrambi i metodi dei plugin quando la scoperta plugin è dichiarata.
- `providerAdapterConformance.test.ts:89` raccoglie tutte le dichiarazioni non valide in un solo errore.
- `providerAdapterConformance.test.ts:104` segnala la registrazione doppia di un provider invece di sovrascriverla in silenzio.
- `providerAdapterConformance.test.ts:113` rifiuta un adattatore a cui manca un metodo obbligatorio.
- `Layers/ProviderSessionDirectory.test.ts:91` persiste i campi runtime e fonde gli aggiornamenti del payload.
- `Layers/ProviderSessionDirectory.test.ts:136` riporta `adapterKey` al nuovo provider quando il provider cambia senza chiave esplicita.
- `Layers/ProviderSessionDirectory.test.ts:167` reidrata i legami persistiti dopo il riavvio del layer.
- `Layers/ProviderSessionDirectory.test.ts:241` salta i legami vecchi con nome di provider sconosciuto in `listBindings`.
- `Layers/ProviderSessionDirectory.test.ts:272` tratta un legame con provider sconosciuto come nessun legame.
- `Layers/ProviderSessionReaper.test.ts:161` chiude le sessioni inattive senza turni attivi conservando il cursore.
- `Layers/ProviderSessionReaper.test.ts:209` salta le sessioni inattive che hanno un turno attivo.
- `Layers/ProviderSessionReaper.test.ts:258` salta la spazzata quando `stopRuntimeSession` non è disponibile.
- `Layers/ProviderSessionReaper.test.ts:302` conserva il cursore di ripresa Codex dopo una spazzata su una sessione preriscaldata.
- `providerRuntimeReconciliation.test.ts:164` preferisce un errore vivo terminale ai metadati stantii del turno attivo.
- `providerRuntimeReconciliation.test.ts:265` non recupera un avvio in coda che non ha ancora un turno concreto.
- `providerRuntimeReconciliation.test.ts:441` non attribuisce l'errore del provider a un turno proiettato diverso.
- `providerRuntimeReconciliation.test.ts:592` usa un messaggio reale quando la sessione riporta un errore vuoto.
- `providerRuntimeReconciliation.test.ts:609` tratta un id di turno vuoto come assente invece di chiudere il turno "".
- `providerRuntimeReconciliation.test.ts:663` non chiude nulla mentre la pompa degli eventi non è sana.
- `providerRuntimeReconciliation.test.ts:687` non chiude nulla mentre il journal ha righe non ingerite.
- `providerRuntimeReconciliation.test.ts:704` chiude comunque un thread abbandonato nonostante il journal in ritardo.
- `providerRuntimeReconciliation.test.ts:771` non considera stantio un turno che sta trasmettendo, se solo la riga di sessione è ferma.
- `keyedLock.test.ts:83` interrompe un attendente in coda senza lasciare che i chiamanti successivi scavalchino chi tiene il lock.
- `providerStartupLifecycle.test.ts:85` registra una scadenza come `HandshakeTimeout` e non come annullamento.
- `providerLifecycleCoordinator.test.ts:71` ripristina la generazione precedente quando una corsa fallisce prima di prendere possesso.
- `providerRuntimeEventPump.test.ts:108` mette in quarantena un errore permanente e continua con gli eventi successivi.
- `providerRuntimeEventIngress.test.ts:40` conserva la chiusura dei task e gli abort di turno sotto pressione dei callback.
- `Layers/ProviderDiscoveryService.test.ts:335` serve la seconda scoperta modelli dalla cache condivisa senza richiamare l'adattatore.
- `Layers/ProviderDiscoveryService.test.ts:291` non invoca l'adattatore per un provider disattivato.

### In Trama

- Cache dello stato: un `actor ProviderStatusStore` con un file JSON per provider in `Application Support/.../provider-status/<provider>.json`, scritto con `Data.write(to:options: .atomic)` e permessi `0o600`. Lettura una volta all'avvio, scrittura solo quando lo stato cambia. `Codable` al posto di `Schema`, e un file illeggibile si ignora.
- Un solo controllo alla volta: al posto del fiber condiviso, un `actor` che tiene un `Task<[ProviderStatus], Never>?` e lo restituisce a chi arriva durante il controllo, più un booleano `needsFollowUp`.
- Cache dei modelli: un `actor ModelCatalogCache` con `[Key: Entry]` e `[Key: Task<...>]` per il volo singolo. La chiave è una `struct Hashable` con gli stessi cinque campi. I cinque tempi diventano costanti statiche. Il timeout di 45 secondi si fa con un gruppo di task e un `Task.sleep` concorrente, perché `URLSession` non copre la scoperta via processo.
- Lo sfratto LRU non può usare l'ordine di iterazione di un `Dictionary` Swift: serve una lista di chiavi in ordine di inserimento accanto al dizionario.
- Conformità: in Swift un protocollo con requisiti opzionali non esiste. Le cinque coppie diventano un controllo su una `struct ProviderCapabilities` più metodi che restituiscono `nil` per difetto, verificato in un test di conformità invece che al lancio. Trama può fare meglio di Synara legando capacità e metodo nel tipo, con enum di casi associati.
- Directory delle sessioni: nessuna tabella SQLite. Il legame per thread va nel documento del progetto, con `resumeCursor` come `Data` opaca del provider, come già deciso in V02. Restano utili le regole di `upsert`: cambio di provider che azzera i campi ereditati, fusione del payload, `lastSeenAt` sempre aggiornato.
- Chiusura delle sessioni inattive: un `Task` periodico ogni 5 minuti che chiude i thread fermi da 30 minuti senza turno attivo. I due valori vanno confermati sui turni lunghi del Coordinatore, come già annotato per il watchdog dei 15 secondi.
- Riconciliazione: la funzione di pianificazione è pura e si porta quasi alla lettera. I freni contro il falso positivo vanno tenuti, altrimenti la chat dichiara interrotto un turno che sta lavorando.

### Da non portare

- `Effect`, `Layer`, `Ref`, `Deferred`, `Fiber`, `PubSub`, `Scope`, `Schedule`, `Exit`, `Schema`: tutta l'impalcatura Effect.
- La tabella `provider_session_runtime` e le sue migrazioni.
- `EventNdjsonLogger` e la rotazione dei file di log per thread: la diagnostica di Trama è un'altra cosa.
- `providerBinaryResolution.ts` nella parte Windows (`LOCALAPPDATA`), inutile su macOS.
- La pompa degli eventi con quarantena e stati di salute: serve perché Synara persiste ogni evento in un journal. Trama non lo fa.
- `unmappedProviderEvents.ts` per intero nella sua forma attuale: le espressioni regolari di redazione sono tarate sui log di nove CLI. Serve la redazione, non queste regole.

### Non trovato

- I flag di capacità chiesti dal ticket V08 (thread persistente, ripresa, strumenti host, override per turno, uso token) non esistono in `ProviderAdapterCapabilities`. Confermata la nota già presente in sezione 5.
- Nessuna versione minima dichiarata per Cursor, Grok, Droid, OpenCode, Pi e Devin.
- `Layers/EventNdjsonLogger.test.ts` esiste ma non contiene casi `it(...)` individuabili con una ricerca sul nome; il file ha un solo `describe` a riga 30. Nessun caso limite citato da lì.
- Nessuna cache per `listAgents`, `listSkills`, `listCommands` o `listPlugins`: solo `listModels` passa dalla cache condivisa.
- Non esiste una costante di timeout globale per il controllo di stato equivalente al tetto dei 45 secondi della scoperta modelli; i timeout della salute sono per sonda dentro `ProviderHealth.ts`.
