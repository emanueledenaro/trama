# Trama

Trama è un'app desktop per leggere un repository, collegare una richiesta ai moduli del progetto e conservare decisioni, lavoro e verifiche sullo stesso candidato. Usa Codex App Server di OpenAI come motore del Coordinatore e GitHub CLI per le operazioni GitHub esplicite.

L'app è scritta in Electron e riprende l'interfaccia di [Synara](https://github.com/Emanuele-web04/synara) (vedi [ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md)). Il codice è in [`app/`](app). I sorgenti della versione SwiftUI sono stati rimossi il 23 settembre 2026 e restano nella cronologia git.

Il progetto è in alpha. La prima prova reale dell'app Electron su sé stessa è del 24 settembre 2026 ed è registrata in [V09](docs/verifiche/v09-trama-su-trama-2026-09-24.md). Il repository pubblico è [emanueledenaro/trama](https://github.com/emanueledenaro/trama) e il lavoro pianificato è registrato nelle [GitHub Issues](https://github.com/emanueledenaro/trama/issues).

## Requisiti

- macOS, Linux o Windows.
- Node.js 22 e npm.
- Git.
- [GitHub CLI](https://cli.github.com/) per leggere o pubblicare issue. Le operazioni che scrivono sul remoto richiedono un accesso `gh` valido e un'azione esplicita nell'app.
- Codex CLI con un account ChatGPT. Trama rifiuta account API key e provider diversi da OpenAI per evitare un passaggio implicito alla fatturazione API. In alternativa il Coordinatore può usare un altro provider supportato a cui hai già fatto l'accesso dalla sua CLI.
- Per eseguire i test Node del candidato con la rete locale: `sandbox-exec` su macOS (già presente) o `bubblewrap` su Linux. Senza, Trama usa la sandbox di Codex, che blocca anche 127.0.0.1.

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

## Come funziona

- **Coordinatore.** È l'unico interlocutore. Studia il progetto, propone gli sviluppatori e scrive nella chat con risposte strutturate: conclusione in apertura, elenchi, tabelle di confronto e avvisi per decisioni e blocchi.
- **Interrogatorio prima del piano.** Prima che una richiesta diventi un piano o un incarico, il Coordinatore la chiarisce in round numerati con la skill originale `grilling` di AI Hero. Ogni domanda è una scheda di decisione con un'alternativa consigliata. Il piano parte solo quando tutte le domande del round hanno risposta.
- **Patto e mandato.** Solo le risposte della persona entrano nel Patto. Il mandato dice cosa il Coordinatore può fare da solo.
- **Team.** Ogni progetto ha gli sviluppatori proposti dal Coordinatore e undici ruoli fissi: QA, UX, ricerca, documentazione e dominio, bug triage e debugger, revisore della spec, Clean Code, guardiano delle regressioni, sicurezza, prestazioni e DevOps. Il pannello Team mostra per ogni momento (chiarimento e spec, fette, candidato, in sottofondo) chi interviene. L'esecuzione dei ruoli fissi nel loro momento non è ancora collegata ([#147](https://github.com/emanueledenaro/trama/issues/147), [#148](https://github.com/emanueledenaro/trama/issues/148)).
- **Obiettivi.** Risultati di progetto con esempi accettati e rifiutati, salvati nel documento del progetto prima di essere mostrati (ADR 0013).
- **Verifiche.** Trama esegue da sola i controlli sul candidato: `git_status`, `git_diff_check`, `swift_build`, `swift_test`, `node_test` e `node_typecheck`. Le verifiche Node girano nel worktree con le dipendenze prestate dal checkout quando `package-lock.json` coincide, in una sandbox che permette solo la rete locale.
- **Skill.** Il pacchetto completo delle skill di Matt Pocock (v1.2.3) è incluso con i nomi di Trama, per esempio `ask-trama` e `setup-trama`. Si richiamano con `/` nel composer. Dettagli in [docs/aihero-attribution.md](docs/aihero-attribution.md).
- **Interfaccia.** Pannelli (obiettivi, mappa, Patto, mandato, team, issue, memoria) nella barra laterale, barra laterale e inspector ridimensionabili, tema chiaro e scuro per ogni provider, finestra in vetro su macOS e Windows 11. Impostazioni e Collegamenti sono una pagina unica con le sezioni generali, collegamenti, metodo, apprendimento e monitor.

## Struttura

- `app/src/main`: processo principale. Scansione del repository, Coordinatore, server MCP degli strumenti su `127.0.0.1`, Patto, mandato, team, obiettivi, verifiche, GitHub e persistenza.
- `app/src/main/core/nativeSkills.ts`: consegna una skill di AI Hero senza modifiche, con un collegamento di Trama che traduce i verbi della skill negli strumenti di Trama.
- `app/src/main/core/providers`: gli adattatori dei nove provider portati da Synara (ADR 0012) dietro la forma comune `AgentRuntime`: Codex, Claude Agent, Cursor, Grok, Droid, Devin, OpenCode, Antigravity e Pi.
- `app/src/preload`: bridge IPC con azioni tipizzate. Il renderer non ha accesso a Node.
- `app/src/main/core/learning`: l'apprendimento del Coordinatore portato da [Hermes Agent](https://github.com/NousResearch/hermes-agent) (ADR 0014, [attribuzione](docs/hermes-attribution.md)): memoria `MEMORY.md` e `USER.md`, ricerca nei dialoghi passati, skill apprese, revisione dell'esperienza e manutenzione delle skill.
- `app/src/renderer`: interfaccia React con Tailwind CSS 4 e `@base-ui/react`, costruita sui token di design di Synara.
- `app/src/shared`: tipi e logica condivisa, come la timeline della conversazione, i round dell'interrogatorio e i ruoli del team.
- `app/resources/AIHero`: le skill di AI Hero con licenza e `bundle.json`, che registra ogni sostituzione di nome. `app/scripts/sync-aihero.mjs` ricostruisce il pacchetto da un checkout della sorgente.
- `app/resources/DemoProject`: il progetto di esempio.
- `app/test-fixtures/fake-codex.mjs`: un app-server di prova per i test e per `ui-check`. Le sue risposte non sono risultati di Codex.

## Primo uso

1. Apri un progetto esistente oppure il progetto di esempio.
2. Apri Impostazioni, sezione Collegamenti, e verifica i provider: Codex con un account ChatGPT, oppure un altro provider a cui hai già fatto l'accesso dalla sua CLI. La guida introduttiva ti accompagna al primo avvio e si riapre dal menu Aiuto.
3. Se vuoi usare GitHub, esegui prima `gh auth login` nel terminale e controlla il repository mostrato dall'app.
4. Leggi lo studio del Coordinatore e conferma o correggi gli sviluppatori proposti.
5. Scrivigli una richiesta. Puoi scegliere un modulo come contesto dal composer e una skill con `/`.
6. Rispondi ai round di domande e alle schede di mandato: solo le tue risposte entrano nel Patto e nel mandato.

Trama salva progetti recenti, conversazioni e stato operativo nella cartella dati dell'utente, sotto `Trama/Desktop` (`~/Library/Application Support/Trama/Desktop` su macOS, `~/.config/Trama/Desktop` su Linux, `%APPDATA%\Trama\Desktop` su Windows). Al primo avvio l'app legge i progetti recenti della versione SwiftUI in `Trama/` e, all'apertura di un progetto, ne importa conversazione, Patto, mandato, memoria e thread del Coordinatore. I file della versione SwiftUI non vengono modificati. Quello che il Coordinatore impara sta nella stessa cartella, sotto `Learning/`, e mai nel repository del progetto. Le credenziali ChatGPT restano nel componente ufficiale Codex. L'app non legge `auth.json` e non copia token.

## Repository supportati

La prima analisi strutturale legge progetti Swift e JavaScript o TypeScript. Per Swift riconosce gli import diretti. Per file `js`, `ts`, `mjs`, `cjs`, `jsx` e `tsx` riconosce import e riferimenti relativi. `package.json` entra nell'indice; gli altri file JSON non vengono trattati come sorgente.

Il raggruppamento dei moduli deriva dai percorsi reali, con un trattamento specifico per cartelle `Sources` e `src`. Trama non inventa moduli semantici quando il repository non li dichiara. Segreti, credenziali, symlink e percorsi fuori dalla radice sono esclusi dall'indice.

## Limiti attuali

- La prima prova reale ([V09](docs/verifiche/v09-trama-su-trama-2026-09-24.md)) ha superato il percorso di base con Claude e con Pi su account veri: messaggio, strumento di Trama, interruzione, riavvio e ripresa. Il percorso completo con Codex non è ancora stato eseguito, perché l'account di prova aveva l'utilizzo esaurito. Nessun candidato è stato dichiarato e verificato dall'inizio alla fine.
- Cursor, Grok, Droid, Devin, OpenCode e Antigravity hanno un adattatore ma sono provati solo con CLI, server e SDK finti. Droid non è stato rilevato sulla macchina di prova. Antigravity lavora solo in un worktree, senza shell né rete. Il passaggio da un provider all'altro è verificato solo dal vivo.
- La pubblicazione di pull request è provata fino al push del branch; la creazione con `gh` non è ancora stata provata su un repository reale. L'elenco completo è nell'[ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md).
- La sandbox Node con rete locale è provata su macOS. Su Linux `bubblewrap` non è stato provato su una macchina reale. Su Windows resta la sandbox di Codex, quindi i test che aprono un server locale falliscono.
- Alcuni documenti di pianificazione (`docs/piano-operativo.md`, spec del verticale) descrivono ancora la versione SwiftUI e possono dare al Coordinatore un quadro sbagliato del progetto.
- Il workflow `Rilascio` (`.github/workflows/release.yml`) produce i pacchetti per macOS, Windows e Linux a ogni tag `v*`. Firma e notarizzazione partono solo con i secret `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`; senza, i pacchetti restano non firmati. Nessun pacchetto firmato è ancora stato prodotto.
- La CI (`.github/workflows/electron.yml`) esegue su Ubuntu con Node 22 controllo dei tipi, test, build e `ui-check`, e allega le schermate. Le prove locali della versione SwiftUI, ormai rimossa, restano in [docs/verifiche-locali.md](docs/verifiche-locali.md) come registro storico.
- Trama è distribuito con licenza MIT. L'interfaccia riprende il design di Synara, anch'esso MIT, con l'attribuzione in [docs/synara-attribution.md](docs/synara-attribution.md). Le skill di Matt Pocock includono licenza MIT e attribuzione in [docs/aihero-attribution.md](docs/aihero-attribution.md); l'apprendimento di Hermes Agent è attribuito in [docs/hermes-attribution.md](docs/hermes-attribution.md). Codex CLI viene installato separatamente e non è incluso nell'app.

Questi limiti sono tracciati nei ticket T01-T18 e nelle [GitHub Issues](https://github.com/emanueledenaro/trama/issues). La presenza del codice o di un test locale non chiude da sola un ticket.
