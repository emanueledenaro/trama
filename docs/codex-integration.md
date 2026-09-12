# Integrazione con Codex App Server

Questa nota descrive il contratto usato da `CodexClient`. I dati verificati provengono da Codex CLI 0.148.0 installato il 12 settembre 2026 e dagli schemi generati con `codex app-server generate-ts`. La documentazione online può descrivere una versione successiva.

## Responsabilità del client

`CodexClient` è un componente Foundation. Avvia il processo ufficiale Codex, parla JSONL su pipe e restituisce dati tipizzati all'app. Non apre il browser, non legge `auth.json`, non copia token e non espone un metodo RPC generico al renderer.

L'interfaccia pubblica è:

```swift
let client = CodexClient(codexURL: selectedURL)
let account = try await client.connect()
let loginURL = try await client.startLogin()
let apps = try await client.listApps()
let skills = try await client.listSkills(cwd: projectURL)
let plan = try await client.plan(prompt: request, cwd: projectURL) { delta in
    // Inoltrare il testo al MainActor.
}
let result = try await client.execute(
    prompt: request,
    cwd: worktreeURL,
    onText: { delta in /* Inoltrare il testo al MainActor. */ },
    onApproval: { request in
        // Mostrare richiesta, tipo, dettaglio e ID. Restituire la decisione dell'utente.
        return .decline
    }
)
await client.cancelTurn()
client.stop()
```

`cancelTurn()` è asincrono e non propaga un errore quando il turno è già terminato. `connect()` restituisce `.signedOut` oppure `.chatGPT(email:plan:)`. Un account API key o un provider differente produce `unsupportedAccount`, così Trama non passa alla fatturazione API. `ApprovalRequest` contiene `id`, `kind`, `title` e `detail`; l'interfaccia restituisce `.allowOnce` oppure `.decline`.

## Avvio nativo su macOS

Foundation `Process` esegue direttamente il file Codex con stdin, stdout e stderr separati. Il client non passa da una shell. Cerca prima il percorso configurato dall'utente, poi `PATH`, `~/.local/bin/codex`, `/opt/homebrew/bin/codex` e `/usr/local/bin/codex`.

Gli argomenti correnti sono:

```text
app-server --stdio
-c model_provider="openai"
-c openai_base_url="https://chatgpt.com/backend-api/codex"
-c chatgpt_base_url="https://chatgpt.com/backend-api/"
```

Le tre opzioni impediscono al processo di usare un provider o un endpoint Router configurato per altre sessioni Codex. Il client mantiene due processi. Il processo di discovery conserva la configurazione dell'utente per account, skill e collegamenti. Il processo ristretto serve soltanto piano ed esecuzione.

Il prefisso ChatGPT per le Responses è `https://chatgpt.com/backend-api/codex`. Usare soltanto `backend-api/` porta il client a `backend-api/responses` e restituisce 404. I thread del runtime 0.148.0 selezionano esplicitamente `gpt-5.6-terra`, perché un modello globale più recente come `gpt-6-astra` viene rifiutato da questa versione del CLI. Nessuna delle due scelte modifica `config.toml`.

Una app macOS avviata dal Finder può ricevere un `PATH` più corto del terminale. Per questo l'interfaccia deve permettere di scegliere l'eseguibile con `NSOpenPanel` quando la ricerca automatica fallisce. La distribuzione tramite Mac App Store richiede una prova separata: App Sandbox può impedire l'esecuzione di un CLI installato fuori dal bundle. La prima beta locale può usare una build firmata e notarizzata distribuita direttamente, dopo aver verificato licenza e aggiornamenti del componente Codex.

## Protocollo e inizializzazione

Lo stdio usa un oggetto JSON per riga. Il campo `jsonrpc` non compare sul wire. Il parser conserva i blocchi parziali fino al newline, accetta più righe nello stesso blocco e legge stderr in parallelo per evitare che il processo si blocchi.

Il primo scambio per ogni processo è:

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"trama","title":"Trama","version":"0.1.0"},"capabilities":{"experimentalApi":true,"requestAttestation":false}}}
{"method":"initialized","params":{}}
```

Il client aspetta la risposta a `initialize` prima di inviare `initialized`. Conserva `userAgent`, `codexHome`, `platformFamily` e `platformOs` come `ServerInfo`. `experimentalApi` serve a `app/list` nella versione 0.148.0. La pianificazione non usa la modalità Plan sperimentale.

Messaggi con `id` e `result` oppure `error` sono risposte. Un messaggio con `method` e `id` è una richiesta del server. Un messaggio con `method` senza `id` è una notifica. Risposte, richieste e notifiche possono arrivare intercalate, quindi il client abbina le risposte per `id`.

Ogni notifica corrente può includere `emittedAtMs`. I decoder ignorano campi sconosciuti. I valori enum e i tipi di item possono crescere tra versioni, quindi il trasporto decodifica prima un albero JSON e interpreta soltanto i campi usati.

## Account e login ChatGPT

`connect()` chiama `account/read` con `refreshToken: false` dopo l'handshake. Le forme utili per Trama sono:

```json
{"account":null,"requiresOpenaiAuth":true}
{"account":{"type":"chatgpt","email":"user@example.com","planType":"plus"},"requiresOpenaiAuth":true}
{"account":{"type":"apiKey"},"requiresOpenaiAuth":true}
```

`email` può essere `null`. `planType` ha più valori e Trama lo conserva come stringa per accettare piani aggiunti in futuro.

Quando l'account è assente, `startLogin()` rilegge prima `account/read`, poi invia:

```json
{"method":"account/login/start","id":3,"params":{"type":"chatgpt"}}
```

La risposta contiene `loginId` e `authUrl`. Il livello SwiftUI apre l'URL con `NSWorkspace.shared.open`. Codex ospita il callback locale, conserva le credenziali e aggiorna i token. Il processo deve restare attivo fino a `account/login/completed`. Al ritorno del browser, l'app richiama `connect()` per ottenere email e piano aggiornati.

Un login fallito o annullato arriva con `success: false` e `error`. Il client lo conserva e la lettura successiva restituisce `loginFailed`. L'app deve distinguere questo stato da un processo terminato o da un account ancora assente.

## Connettori

`listApps()` unisce due letture:

- `app/list` fornisce nome, descrizione, URL di installazione, accessibilità e abilitazione.
- `app/installed` fornisce lo stato installato effettivo e `callable`.

`isAccessible`, `isEnabled`, `isInstalled` e `isCallable` descrivono condizioni diverse. Un remote Git, il login di `gh` o la presenza di un URL di installazione non dimostrano che il connettore sia invocabile.

`listSkills(cwd:)` chiama `skills/list` con la directory esplicita e `forceReload: true`. Restituisce nome, percorso assoluto e stato `enabled` di ogni skill caricata. Se Codex segnala errori di scansione, il metodo restituisce `skillDiscoveryFailed` invece di presentare un catalogo completo.

## Isolamento degli strumenti del thread

La sandbox del processo copre comandi locali e accesso al filesystem. La documentazione OpenAI precisa che il traffico delle app e dei connettori non passa dal proxy di rete della sandbox. `networkAccess: false` non basta quindi a rendere locale un turno.

Prima di avviare il processo ristretto, il client esegue `codex mcp list --json`. Usa soltanto nome e tipo di trasporto, senza leggere file di credenziali. La lettura ha un limite di 5 secondi e 1 MiB; timeout, output eccessivo, nome incompatibile o trasporto sconosciuto fermano l'avvio. Per ogni server crea un override completo e disabilitato sulla riga di comando. I server stdio ricevono `command="/usr/bin/false"`; i server HTTP ricevono un URL loopback inerte. L'entry completa evita l'errore `invalid transport` prodotto da un semplice `enabled=false` su server provenienti da plugin.

Gli override sono applicati prima di `initialize`:

```text
-c 'mcp_servers.server-stdio={command="/usr/bin/false",enabled=false}'
-c 'mcp_servers.server-http={url="http://127.0.0.1:9/mcp",enabled=false}'
--disable apps --disable plugins --disable hooks --disable multi_agent
```

Il processo ristretto usa lo stesso `CODEX_HOME`, quindi Codex riusa il login ChatGPT ufficiale. Nessun token viene letto o copiato da Trama. Il processo di discovery resta disponibile e `listApps()` continua a mostrare lo stato reale dell'utente.

I nomi MCP sono ammessi soltanto con lettere, numeri, trattino e underscore. La build locale interpreta le virgolette nel percorso `-c` come parte del nome. L'override usa quindi `mcp_servers.nome` dopo la validazione.

I nomi MCP devono contenere soltanto lettere, cifre, trattino o underscore. Il parser della build locale interpreta le virgolette nel percorso `-c` come parte del nome e creerebbe una voce duplicata, lasciando attivo il server originale. Un nome fuori da questo insieme fa fallire la preparazione del runtime. L'inventario ha un timeout di cinque secondi e un limite di un MiB.

Il campo `thread/start.config` contiene una configurazione annidata valida solo per il nuovo thread:

```json
{
  "web_search": "disabled",
  "features": {
    "apps": false,
    "plugins": false,
    "hooks": false,
    "multi_agent": false
  },
  "apps": {
    "_default": {"enabled": false},
    "app-configurata": {"enabled": false}
  }
}
```

`features.apps: false` rimuove l'integrazione app. `apps._default.enabled: false` copre le app senza una regola specifica. Il thread non aggiunge voci MCP: quelle appartengono già alla configurazione di avvio del processo ristretto.

Dopo `thread/start`, il client verifica lo snapshot del thread con `mcpServerStatus/list` e `app/installed`. Una riga MCP senza strumenti è solo stato informativo. Una riga con strumenti indica che il modello potrebbe invocarli: il client restituisce `toolIsolationUnavailable` prima di `turn/start`, indicando i server ancora utilizzabili. La schermata dei collegamenti continua a usare la configurazione globale.

## Sessione di piano

Ogni richiesta crea un thread effimero. Il livello applicativo conserva richiesta, snapshot e piano; il thread effimero evita di aggiungere conversazioni tecniche non riprendibili alla cronologia Codex.

Il thread usa il contratto stabile generato dal CLI 0.148.0:

```json
{
  "method": "thread/start",
  "id": 10,
  "params": {
    "modelProvider": "openai",
    "cwd": "/percorso/progetto",
    "approvalPolicy": "never",
    "sandbox": "read-only",
    "ephemeral": true,
    "serviceName": "trama",
    "config": {
      "web_search": "disabled",
      "features": {"apps": false, "plugins": false, "hooks": false},
      "apps": {"_default": {"enabled": false}}
    },
    "developerInstructions": "Produce a plan only..."
  }
}
```

Il turno ripete i limiti che contano:

```json
{
  "method": "turn/start",
  "id": 11,
  "params": {
    "threadId": "thread-id",
    "input": [{"type":"text","text":"richiesta","text_elements":[]}],
    "cwd": "/percorso/progetto",
    "approvalPolicy": "never",
    "sandboxPolicy": {"type":"readOnly","networkAccess":false}
  }
}
```

`plan` accetta anche `outputSchema: Data?`. Il client verifica che i byte contengano JSON valido con una radice oggetto e inoltra il valore come `turn/start.outputSchema`. Dati malformati, array o valori scalari producono `invalidOutputSchema` prima di creare il thread. Se il parametro è `nil`, il campo viene omesso e i chiamanti esistenti conservano il comportamento precedente.

La documentazione online corrente mostra alcuni valori camelCase per `thread/start`. Il CLI 0.148.0 genera `read-only`, `workspace-write`, `on-request` e `never` per quel metodo. `turn/start.sandboxPolicy` usa invece `readOnly`. L'adapter segue lo schema del binario installato e i test bloccano queste forme.

Il client usa `item/agentMessage/delta` per lo streaming. Accetta anche `item/plan/delta`, ma il testo autorevole arriva dall'item `agentMessage` o `plan` dentro `item/completed`. La conclusione del lavoro è `turn/completed` con stato `completed`, `interrupted` o `failed`. Un evento `error` con `willRetry: true` non chiude il turno.

`cancelTurn()` invia `turn/interrupt` con thread e turno correnti. Il chiamante aspetta comunque `turn/completed`; il risultato diventa `turnInterrupted` quando lo stato finale è `interrupted`.

## Approvazioni ed errori

La configurazione `never` evita prompt di approvazione normali. Il client gestisce comunque le richieste del server per non lasciare il turno sospeso:

- comandi e cambi file ricevono `decision: decline`;
- richieste di permessi ricevono un insieme vuoto con ambito del turno;
- richieste MCP ricevono `action: decline`;
- metodi sconosciuti ricevono l'errore RPC `-32601`.

Il client non espone un pulsante per concedere scrittura durante la pianificazione. Una futura sessione di esecuzione deve avere un adapter e un'interfaccia separati.

Ogni richiesta RPC ha un timeout. JSON malformato, riga eccessiva, uscita del processo e rottura della pipe fanno fallire tutte le richieste pendenti. stderr viene limitato agli ultimi 8192 byte e compare nell'errore di uscita senza essere interpretato come JSON.

`thread/start` può attendere l'avvio dei server MCP configurati. Il client gli concede almeno 60 secondi, anche quando il timeout RPC ordinario è più breve. Gli override del thread disabilitano i server rilevati prima dell'avvio. Trama non modifica la configurazione globale dei connettori.

## Sessione di esecuzione

`execute` usa un thread effimero distinto dalla pianificazione. Il thread dichiara `approvalPolicy: "on-request"` e `sandbox: "workspace-write"`. Il turno limita le scritture alla sola directory ricevuta:

```json
{
  "approvalPolicy": "on-request",
  "sandboxPolicy": {
    "type": "workspaceWrite",
    "writableRoots": ["/percorso/worktree"],
    "networkAccess": false,
    "excludeTmpdirEnvVar": true,
    "excludeSlashTmp": true
  }
}
```

Le approvazioni per comandi e modifiche file arrivano a `onApproval`. Per le richieste v2, `.allowOnce` diventa `decision: "accept"` e `.decline` diventa `decision: "decline"`. I metodi legacy `execCommandApproval` e `applyPatchApproval` ricevono rispettivamente `"approved"` oppure una decisione `denied` con motivazione. Le richieste di permessi, le richieste MCP e i metodi sconosciuti non entrano nel callback: il client concede un insieme vuoto, rifiuta o restituisce `-32601` secondo il metodo.

Durante un'approvazione il lettore JSONL continua a elaborare eventi. `cancelTurn()` annulla le callback pendenti, invia una decisione negativa per ogni richiesta ancora aperta e poi chiama `turn/interrupt`. Una risposta positiva arrivata in ritardo dalla UI viene ignorata.

## Sandbox dei check locali

`CheckSandbox.command(for:arguments:cwd:codexURL:)` prepara un comando Foundation `Process` senza shell intermedia. Usa la sintassi piatta del CLI 0.148.0:

```text
codex sandbox -P trama_check_sandbox_v1 -C /worktree --include-managed-config \
  -c 'permissions.trama_check_sandbox_v1={extends=":read-only",filesystem={":workspace_roots"={"."="write"}},network={enabled=false}}' \
  -- /usr/bin/env TMPDIR=/worktree/ ... /percorso/check argomenti
```

Il profilo nasce da `:read-only`, concede scrittura soltanto alla radice di lavoro e disabilita la rete. `--include-managed-config` conserva eventuali limiti amministrativi. Le cache Clang, SwiftPM e XDG e `TMPDIR` vengono dirette dentro il worktree. Il wrapper rifiuta directory mancanti, symlink finali, `/`, la home, eseguibili non validi e argomenti con byte nullo. Se Codex manca, il chiamante riceve un errore e non deve eseguire il comando direttamente.

SwiftPM tenta di creare una sandbox interna. Quando il check è già dentro la sandbox Codex, il comando deve includere `swift test --disable-sandbox` e percorsi `--scratch-path` e `--cache-path` interni al worktree. La sandbox esterna resta attiva.

La prova locale ha verificato una scrittura riuscita nel worktree, una scrittura negata su un sentinel adiacente e una connessione loopback negata mentre la stessa connessione funzionava fuori sandbox. Un progetto SwiftPM minimo ha completato i test con cache e temporanei interni. Non viene usato un profilo Seatbelt costruito da Trama.

## Compatibilità e limiti

Il comando App Server e il trasporto WebSocket sono documentati come sperimentali e non supportati per carichi di produzione. Lo stdio è il trasporto scelto da Trama, ma il prodotto resta dipendente da un protocollo sperimentale. Prima di distribuire una beta serve una matrice di versioni Codex supportate e una prova del login reale.

`clientInfo.name` identifica il client nei log di conformità OpenAI. La documentazione chiede ai nuovi client destinati all'uso enterprise di contattare OpenAI per entrare nell'elenco dei client conosciuti.

Gli schemi generati dalla versione installata e la pagina online non sono identici. Per esempio, l'account Bedrock locale usa `usesCodexManagedCredentials`, mentre la pagina corrente mostra `credentialSource`. Trama tratta account diversi da ChatGPT come non supportati e non dipende da quel campo.

I test automatici usano un trasporto simulato. Coprono framing spezzato, risposta malformata, timeout, uscita del processo, login senza token, sandbox, streaming, annullamento, connettori, override per thread, verifica MCP e rifiuto delle approvazioni. Non dimostrano OAuth, accesso a un repository reale, comportamento di App Sandbox o un turno modello effettivo.

## Fonti ufficiali

- [Codex App Server](https://learn.chatgpt.com/docs/app-server), raggiungibile anche da `https://developers.openai.com/codex/app-server`.
- [Riferimento configurazione Codex](https://learn.chatgpt.com/docs/config-file/config-reference), raggiungibile anche da `https://developers.openai.com/codex/config-reference`.
- [Autenticazione Codex](https://learn.chatgpt.com/docs/auth).
