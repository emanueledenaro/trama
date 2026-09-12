# Trama

Trama è un'app macOS nativa in SwiftUI per leggere un repository, collegare una richiesta ai moduli del progetto e conservare decisioni, lavoro e verifiche sullo stesso candidato. Usa Codex App Server di OpenAI per pianificazione ed esecuzione e usa GitHub CLI per le operazioni GitHub esplicite.

Il progetto è in alpha. Il repository pubblico è [emanueledenaro/trama](https://github.com/emanueledenaro/trama) e il lavoro pianificato è registrato nelle [GitHub Issues](https://github.com/emanueledenaro/trama/issues). La matrice aggiornata di ciò che esiste e di ciò che deve ancora essere provato è in [docs/stato-beta.md](docs/stato-beta.md).

## Requisiti

- macOS 14 o successivo.
- Xcode Command Line Tools con toolchain Swift 6. Il package usa `swift-tools-version: 6.0` e compila il sorgente in modalità Swift 5.
- Git.
- [GitHub CLI](https://cli.github.com/) per leggere o pubblicare dati GitHub. Le operazioni che scrivono sul remoto richiedono un accesso `gh` valido e un'azione esplicita nell'app.
- Codex CLI 0.148.0 con un account ChatGPT. Trama rifiuta account API key e provider diversi da OpenAI per evitare un passaggio implicito alla fatturazione API.

Il workflow CI installa Codex 0.148.0 tramite npm e usa Node 22. Per installare la stessa versione tramite npm in locale serve anche Node.js.

Puoi controllare gli strumenti prima della compilazione:

```bash
xcode-select -p
swift --version
gh --version
gh auth status
codex --version
```

## Compilazione locale

In un checkout che contiene il sorgente dell'alpha:

```bash
git clone https://github.com/emanueledenaro/trama.git
cd trama
swift test
bash scripts/build-app.sh release
open build/Trama.app
```

`scripts/build-app.sh` compila `Trama`, `TramaMonitor` e le risorse, crea `build/Trama.app` e applica una firma ad hoc locale. Lo script non registra il monitor in background. Questa app non è firmata con Developer ID e non è notarizzata.

## Primo uso

1. Apri un progetto esistente oppure il progetto di esempio.
2. Apri Collegamenti e verifica l'account ChatGPT riconosciuto da Codex.
3. Se vuoi usare GitHub, esegui prima `gh auth login` nel terminale e controlla il repository mostrato dall'app.
4. Seleziona un modulo, descrivi il comportamento richiesto e genera un piano.
5. Rivedi il piano e conferma ogni decisione prima di avviare una sessione di modifica.

Trama salva progetti recenti, richieste e stato operativo in `Application Support/Trama`. Le credenziali ChatGPT restano nel componente ufficiale Codex. L'app non legge `auth.json` e non copia token.

## Repository supportati

La prima analisi strutturale legge progetti Swift e JavaScript o TypeScript. Per Swift riconosce gli import diretti. Per file `js`, `ts`, `mjs`, `cjs`, `jsx` e `tsx` riconosce import e riferimenti relativi. `package.json` entra nell'indice; gli altri file JSON non vengono trattati come sorgente.

Il raggruppamento dei moduli deriva dai percorsi reali, con un trattamento specifico per cartelle `Sources` e `src`. Trama non inventa moduli semantici quando il repository non li dichiara. Segreti, credenziali, symlink e percorsi fuori dalla radice sono esclusi dall'indice.

## Limiti attuali

- Il riconoscimento dell'account ChatGPT e una risposta reale attraverso CodexClient sono stati verificati. Piano ed esecuzione usano un processo distinto, con app e server MCP disabilitati. Il flusso nell'interfaccia è in verifica.
- Il monitor in background è implementato e resta disattivato al primo avvio. L'helper non è stato registrato sul Mac di prova.
- La CI macOS verifica build e test delle revisioni pubblicate. Le prove locali sono descritte in [docs/verifiche-locali.md](docs/verifiche-locali.md).
- Firma Developer ID, notarizzazione e installazione su un secondo Mac non sono state eseguite.
- Trama è distribuito con licenza MIT. Le skill Matt Pocock includono licenza MIT e attribuzione. Codex CLI viene installato separatamente e non è incluso nell'app.

Questi limiti sono tracciati nei ticket T01-T18. La presenza del codice o di un test locale non chiude da sola un ticket.
