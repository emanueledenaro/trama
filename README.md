# Trama

Trama è un'app desktop per leggere un repository, collegare una richiesta ai moduli del progetto e conservare decisioni, lavoro e verifiche sullo stesso candidato. Usa Codex App Server di OpenAI come motore del Coordinatore e GitHub CLI per le operazioni GitHub esplicite.

L'app è scritta in Electron e riprende l'interfaccia di [Synara](https://github.com/Emanuele-web04/synara) (vedi [ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md)). Il codice è in [`app/`](app). I sorgenti della versione SwiftUI sono stati rimossi il 23 settembre 2026 e restano nella cronologia git.

Il progetto è in alpha. Il repository pubblico è [emanueledenaro/trama](https://github.com/emanueledenaro/trama) e il lavoro pianificato è registrato nelle [GitHub Issues](https://github.com/emanueledenaro/trama/issues).

## Requisiti

- macOS, Linux o Windows.
- Node.js 22 e npm.
- Git.
- [GitHub CLI](https://cli.github.com/) per leggere o pubblicare issue. Le operazioni che scrivono sul remoto richiedono un accesso `gh` valido e un'azione esplicita nell'app.
- Codex CLI con un account ChatGPT. Trama rifiuta account API key e provider diversi da OpenAI per evitare un passaggio implicito alla fatturazione API.

## Avvio in sviluppo

```bash
git clone https://github.com/emanueledenaro/trama.git
cd trama/app
npm install
npm run dev
```

`npm run dev` avvia Vite per l'interfaccia, compila il processo principale e apre Electron. `TRAMA_CODEX_PATH` indica un eseguibile Codex diverso da quello trovato nel `PATH`; `TRAMA_DATA_DIR` sposta la cartella dei dati.

Altri comandi, sempre in `app/`:

```bash
npm run typecheck   # controllo dei tipi
npm test            # test del processo principale e della logica condivisa
npm run build       # build di interfaccia e processo principale
npm start           # build e avvio
npm run ui-check    # avvia l'app con un Codex di prova e salva le schermate in ui-check/
npm run dist        # pacchetto con electron-builder
```

## Struttura

- `app/src/main`: processo principale. Scansione del repository, Coordinatore, server MCP degli strumenti su `127.0.0.1`, Patto, mandato, GitHub e persistenza.
- `app/src/main/core/providers`: gli adattatori dei nove provider portati da Synara (ADR 0012) dietro la forma comune `AgentRuntime`: Codex, Claude Agent, Cursor, Grok, Droid, Devin, OpenCode, Antigravity e Pi.
- `app/src/preload`: bridge IPC con azioni tipizzate. Il renderer non ha accesso a Node.
- `app/src/renderer`: interfaccia React con Tailwind CSS 4 e `@base-ui/react`, costruita sui token di design di Synara.
- `app/src/shared`: tipi e logica condivisa, come la timeline della conversazione.
- `app/test-fixtures/fake-codex.mjs`: un app-server di prova per i test e per `ui-check`. Le sue risposte non sono risultati di Codex.

## Primo uso

1. Apri un progetto esistente oppure il progetto di esempio.
2. Apri Collegamenti e verifica i provider: Codex con un account ChatGPT, oppure un altro provider a cui hai già fatto l'accesso dalla sua CLI. La guida introduttiva ti accompagna al primo avvio e si riapre dal menu Aiuto.
3. Se vuoi usare GitHub, esegui prima `gh auth login` nel terminale e controlla il repository mostrato dall'app.
4. Leggi lo studio del Coordinatore e scrivigli. Puoi scegliere un modulo come contesto dal composer.
5. Rispondi alle schede di decisione e di mandato: solo le tue risposte entrano nel Patto e nel mandato.

Trama salva progetti recenti, conversazioni e stato operativo nella cartella dati dell'utente, sotto `Trama/Desktop` (`~/Library/Application Support/Trama/Desktop` su macOS, `~/.config/Trama/Desktop` su Linux, `%APPDATA%\Trama\Desktop` su Windows). Al primo avvio l'app legge i progetti recenti della versione SwiftUI in `Trama/` e, all'apertura di un progetto, ne importa conversazione, Patto, mandato, memoria e thread del Coordinatore. I file della versione SwiftUI non vengono modificati. Le credenziali ChatGPT restano nel componente ufficiale Codex. L'app non legge `auth.json` e non copia token.

## Repository supportati

La prima analisi strutturale legge progetti Swift e JavaScript o TypeScript. Per Swift riconosce gli import diretti. Per file `js`, `ts`, `mjs`, `cjs`, `jsx` e `tsx` riconosce import e riferimenti relativi. `package.json` entra nell'indice; gli altri file JSON non vengono trattati come sorgente.

Il raggruppamento dei moduli deriva dai percorsi reali, con un trattamento specifico per cartelle `Sources` e `src`. Trama non inventa moduli semantici quando il repository non li dichiara. Segreti, credenziali, symlink e percorsi fuori dalla radice sono esclusi dall'indice.

## Limiti attuali

- L'app Electron è stata provata con un app-server Codex di prova (`app/test-fixtures/fake-codex.mjs`), nei test e con `npm run ui-check` sotto Linux. Una sessione con Codex reale e un account ChatGPT non è ancora stata eseguita con l'app Electron.
- I nove provider hanno un adattatore. La lettura di account e modelli di Claude Agent è stata provata su una CLI reale; i turni reali dei provider diversi da Codex, e gli altri provider in generale, sono provati solo con CLI, server e SDK finti. Antigravity lavora solo in un worktree, senza shell né rete. La pubblicazione di pull request è provata fino al push del branch; la creazione con `gh` non è ancora stata provata su un repository reale. L'elenco è nell'[ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md).
- Il workflow `Rilascio` (`.github/workflows/release.yml`) produce i pacchetti per macOS, Windows e Linux a ogni tag `v*`. Firma e notarizzazione partono solo con i secret `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`; senza, i pacchetti restano non firmati. Nessun pacchetto firmato è ancora stato prodotto.
- La CI verifica build e test dell'app Electron. Le prove locali della versione SwiftUI, ormai rimossa, restano in [docs/verifiche-locali.md](docs/verifiche-locali.md) come registro storico.
- Trama è distribuito con licenza MIT. L'interfaccia riprende il design di Synara, anch'esso MIT, con l'attribuzione in [docs/synara-attribution.md](docs/synara-attribution.md). Le skill Matt Pocock includono licenza MIT e attribuzione. Codex CLI viene installato separatamente e non è incluso nell'app.

Questi limiti sono tracciati nei ticket T01-T18. La presenza del codice o di un test locale non chiude da sola un ticket.
