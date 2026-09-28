# Versioni e rilasci

Questa è la policy di versionamento di Trama (issue #348). Vale per persone e agenti. I workflow che la applicano sono in `.github/workflows/`, gli script in `scripts/release/`.

## Numero di versione

- Trama segue [SemVer 2.0.0](https://semver.org/lang/it/): `MAGGIORE.MINORE.PATCH`.
- Una sola fonte della versione: il campo `version` di `app/package.json`. L'app, i nomi dei pacchetti e il tag la leggono da lì. Nessun altro file la ripete a mano.
- Il tag di una release è `vX.Y.Z`, sul commit di unione della PR di rilascio. I tag `v*` sono immutabili: non si spostano e non si cancellano. Una release sbagliata ottiene un nuovo numero.

## Come si calcola il numero

Il numero viene dai [Conventional Commits](conventional-commits.md) su `main`, letti dall'ultimo tag `v*`. Su `main` ogni commit di unione porta il titolo della PR, quindi conta una voce per PR.

Prima della 1.0 (fase attuale):

- `feat` alza la minore: `0.2.0` diventa `0.3.0`;
- `fix` e `perf` alzano la patch: `0.2.0` diventa `0.2.1`;
- un cambiamento incompatibile (`!` dopo il tipo o footer `BREAKING CHANGE:`) alza la minore, non la maggiore;
- `docs`, `test`, `build`, `ci`, `chore`, `style`, `refactor` e `revert` da soli non chiedono una release.

La 1.0 la decide la persona. Da lì in poi vale SemVer pieno: un cambiamento incompatibile alza la maggiore.

## Pre-release

- Per le prove si pubblica una pre-release `X.Y.Z-beta.N`, per esempio `0.3.0-beta.1`. Altre etichette (`alpha`, `rc`) non si usano.
- Su GitHub compare come pre-release e non diventa mai la release più recente.
- Il numero della beta si passa a mano a `release-prepare.yml`. Dopo una beta, il calcolo automatico propone la versione che la beta anticipava (`0.3.0-beta.2` porta a `0.3.0`). Per un numero diverso si passa la versione a mano.
- In ordine: `0.3.0-beta.1` < `0.3.0-beta.2` < `0.3.0`.

## Cadenza

- Una release quando un gruppo di lavoro è su `main` e la CI è verde.
- Almeno una a settimana quando ci sono cambiamenti che la chiedono.
- La decide il coordinatore. La persona può chiederne una quando vuole.

## CHANGELOG

- `CHANGELOG.md` segue [Keep a Changelog 1.1.0](https://keepachangelog.com/it-IT/1.1.0/), raggruppato per tipo (`Added`, `Changed`, `Fixed`, ...).
- Le voci vengono dai Conventional Commits, con il link alla PR. `feat` va in Added, `fix` in Fixed, `perf`, `refactor` e `revert` in Changed. Ogni voce è una frase: iniziale maiuscola e punto finale.
- La sezione di una release copre ogni PR unita su `main` dall'ultimo tag. La prima release, senza tag, legge tutta la cronologia di `main`. Una PR che il CHANGELOG cita già non viene ripetuta.
- Le note sotto `[Unreleased]` si possono scrivere a mano, con il link alla PR: la release successiva le sposta nella propria sezione e non aggiunge la voce generata per la stessa PR.
- Lingua: le voci generate vengono dai titoli delle PR, quindi escono in inglese, come il resto di `CHANGELOG.md`. La regola sulla lingua di `AGENTS.md` fa un'eccezione solo per il `README.md`. Finché la persona non decide, la sezione di ogni release si traduce in italiano semplice nella PR di rilascio, oppure la persona aggiunge `CHANGELOG.md` alle eccezioni di `AGENTS.md`. Il paragrafo "Pacchetti" che il workflow aggiunge alle note è in italiano.
- La sezione si può correggere nella PR di rilascio, prima dell'unione.

## Come nasce una release

1. **Preparazione.** Il coordinatore lancia `release-prepare.yml` (a mano, da Actions o con `gh workflow run release-prepare.yml`). Senza input calcola la versione; la prima release, e ogni beta, vogliono la versione esplicita. Il workflow scrive la sezione di `CHANGELOG.md`, aggiorna `app/package.json` e `app/package-lock.json` e apre la PR `chore(release): vX.Y.Z` dal branch `release/vX.Y.Z`. Il nome del branch passa lo stesso controllo di Conventional Branch della CI. Se il branch esiste già senza una PR aperta, per esempio lasciato da una run precedente, il workflow lo rigenera da `main`; con una PR aperta si ferma.
2. **Approvazione.** La persona rivede e approva la PR di rilascio. Il commit di unione su `main` ha l'oggetto `chore(release): vX.Y.Z (#<numero>)`.
3. **Pubblicazione.** All'unione `release-publish.yml` vede una versione con la sua sezione nel CHANGELOG e senza tag. Crea la release in bozza (pre-release per una beta), fa costruire i pacchetti da `release.yml`, allega pacchetti e checksum e pubblica. La pubblicazione crea il tag.

Se un passo fallisce, rilanciare la run: la bozza già creata viene ripresa sullo stesso commit, i file già allegati vengono sostituiti.

Perché la PR di rilascio faccia partire i controlli richiesti serve il segreto `RELEASE_TOKEN` (un token personale con accesso al repository). Senza, il workflow usa il token di GitHub Actions e i controlli della PR non partono da soli.

### Se GitHub non lascia aprire la PR

Senza `RELEASE_TOKEN`, GitHub apre la PR solo se nel repository è attiva l'impostazione Settings, Actions, General, Workflow permissions, "Allow GitHub Actions to create and approve pull requests". Se è spenta, il workflow:

- lascia pubblicato il branch `release/vX.Y.Z` con il CHANGELOG e la versione;
- finisce senza errore, con un avviso;
- scrive nel riepilogo della run il comando `gh pr create` esatto per aprire la PR a mano e le due strade per evitarlo nelle run successive.

Il coordinatore apre la PR con quel comando; la persona la approva come sempre. Attivare l'impostazione o aggiungere `RELEASE_TOKEN` resta una scelta della persona.

## Cosa contiene una release

Ogni release ha i pacchetti delle tre piattaforme, i checksum e le note:

| Piattaforma | File |
| --- | --- |
| macOS Apple Silicon | `Trama-X.Y.Z-arm64.dmg`, `Trama-X.Y.Z-arm64.zip` |
| macOS Intel | `Trama-X.Y.Z-x64.dmg`, `Trama-X.Y.Z-x64.zip` |
| Windows | `Trama-X.Y.Z-x64.exe` (installer NSIS) |
| Linux | `Trama-X.Y.Z-x86_64.AppImage` |
| Tutte | `SHA256SUMS.txt` con il checksum SHA-256 di ogni file |

Per controllare un file scaricato: `sha256sum -c SHA256SUMS.txt --ignore-missing` (Linux), `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` (macOS), `Get-FileHash .\Trama-X.Y.Z-x64.exe` (Windows, da confrontare con la riga del file).

Le note sono la sezione del CHANGELOG, più un paragrafo "Pacchetti" che dice quali file ci sono e se sono firmati.

## Firma e notarizzazione

Le credenziali di firma le mette solo la persona, come segreti del repository. I workflow le usano solo se ci sono; nessun agente le crea, le legge o le chiede in chat.

| Segreto | Uso |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | certificato Developer ID di Apple (`.p12` in base64) e la sua password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarizzazione Apple, solo insieme al certificato |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | certificato di firma del codice per Windows e la sua password |
| `RELEASE_TOKEN` | facoltativo: apre la PR di rilascio e ne fa partire i controlli |

Senza segreti i pacchetti non sono firmati e le note della release lo dicono, con quello che vede chi installa:

- **macOS**: Gatekeeper dice che non può verificare lo sviluppatore. Si apre Trama con clic destro, Apri, oppure da Impostazioni di Sistema, Privacy e sicurezza, Apri comunque.
- **Windows**: SmartScreen mostra "Windows ha protetto il PC". Si sceglie Ulteriori informazioni, poi Esegui comunque.
- **Linux**: l'AppImage non ha firma; va resa eseguibile con `chmod +x`.

## Build di prova

Per provare i pacchetti di una PR o di un commit senza creare una release:

```
gh workflow run release.yml --ref <branch>
gh workflow run release.yml --ref <branch> -f platforms=windows
gh workflow run release.yml -f ref=<sha-del-commit> -f platforms=windows
```

`platforms` vale `all` (predefinito), `windows`, `macos` o `linux`. I pacchetti restano negli artefatti della run (`trama-windows`, `trama-macos`, `trama-linux`, più `checksums`), scaricabili dalla pagina della run o con `gh run download <id-run>`. Il riepilogo della run elenca nomi, dimensioni e checksum. La versione è quella di `app/package.json` sul commit; l'app mostra anche il commit, così una build di prova si distingue da una release.

Il pulsante "Run workflow" nella scheda Actions fa la stessa cosa.

Prima del pacchetto ogni piattaforma fa il controllo dei tipi e la build. La suite di test gira su Linux e su macOS; su Windows non ancora, perché le CLI finte dei provider usate nei test sono script POSIX e molte fixture usano percorsi Unix.

## La versione nell'app

- **Impostazioni, Generale, Informazioni**: versione e commit della build.
- **Informazioni su Trama**: su macOS nel menu Trama, con il pannello di sistema (versione e commit tra parentesi); su Windows e Linux nel menu Aiuto, apre la sezione Informazioni delle Impostazioni.

Entrambi leggono la versione da `app/package.json` al momento della build.

## Passo successivo, fuori da questa policy

Gli aggiornamenti automatici dell'app (electron-updater che legge le release di GitHub) sono il passo successivo. Richiedono pacchetti firmati su macOS e i file `latest*.yml` nelle release; si decidono in una issue a parte.
