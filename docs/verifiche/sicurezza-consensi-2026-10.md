# Sicurezza dei consensi e delle approvazioni (issue #597)

Data: 6 ottobre 2026. Branch `bugfix/issue-597-approvals-from-the-person`, che parte da `main` e dalla PR #604 e la sostituisce.

## Il principio

Un consenso (per sito e per app), il mandato, l'approvazione di un candidato, il sì a un comando senza ritorno, a un invio, a un pagamento o a una cancellazione, e una risposta del Patto valgono solo se arrivano da un'azione della persona nell'interfaccia di Trama. Non da un agente, da uno strumento, da una chiamata IPC fatta per conto di un processo agente, né da input simulato (clic, tasti, automazione della finestra, AppleScript, accessibilità, porte di debug).

Regola fissa della persona: Trama stessa (la finestra e il processo, compreso "Electron" quando gira da sorgente) è sempre esclusa dall'Operatore, con un divieto che nessun consenso sblocca, nemmeno uno già salvato. Trama non propone mai un consenso per sé stessa.

## La prova che il difetto c'era

Il test `app/src/main/selfApproval.integration.test.ts` rifà la simulazione del 6 ottobre con il provider finto: l'Operatore chiede una cancellazione (`rm -rf build`), che aspetta in "Aspetta te"; poi legge la finestra di Trama, Trama chiede il consenso per l'app Trama, la persona lo dà, e il clic dell'Operatore sulla finestra preme il sì della cancellazione. Il test è nel primo commit della PR, prima della correzione. Eseguito su `main` (b577872a) dava 4 test falliti su 4. Il primo errore è l'auto-approvazione stessa:

```
FAIL  the Operator cannot get a consent for Trama and press the yes of Aspetta te with the screen
AssertionError: expected { …(8) } to match object { status: 'waiting' }
-   "status": "waiting",
+   "status": "done",
```

La cancellazione risultava fatta senza il sì della persona. Sulla PR #604 da sola ne fallivano ancora 2 su 4: il comando che guida la finestra o scrive i dati di Trama, e il consenso dentro un testo incollato. Con questa PR passano tutti, insieme ai test aggiunti dopo.

## Le strade analizzate

Per ogni strada: come si arrivava all'auto-approvazione, come è chiusa, quale test lo prova.

### 1. Schermo, mouse e tastiera sulla finestra di Trama

- Come: con il consenso per l'app Trama, `click_screen` premeva un pulsante di "Aspetta te"; `type_on_screen` e `press_key` potevano scrivere nel composer o premere Invio.
- Chiusa da: PR #604 (`app/src/shared/protectedApps.ts`, `operatorScreen.ts`). Trama è riconosciuta per nome (anche "Electron" e gli helper), per bundle id e per PID del suo processo e dei processi figli. Per Trama non nasce nessuna richiesta, non si registra nessun consenso, uno salvato prima non vale. Per un clic conta l'app sotto il puntatore, per il resto quella in primo piano.
- Test: `selfApproval.integration.test.ts` (primi due test, anche con il nome "Electron" e con un nome qualsiasi ma il PID di Trama), `appConsents.integration.test.ts`, `operatorScreen.test.ts`, `protectedApps.test.ts`.

### 2. Impostazioni di Sistema, finestre di autorizzazione, gestori di password

- Come: l'Operatore poteva concedersi i permessi di macOS o leggere una password.
- Chiusa da: stesso elenco della PR #604 (tipo `system` e `passwords`).
- Test: `appConsents.integration.test.ts` ("refuses System Settings and a password manager"), `protectedApps.test.ts`.

### 3. Terminali ed editor di script sullo schermo (nuova)

- Come: con il consenso per il Terminale, l'Operatore poteva scrivere `osascript ...` e premere Invio. Il comando partiva fuori dalla serratura dei segreti e dal sandbox, con i permessi del Terminale, e poteva guidare la finestra di Trama.
- Chiusa da: nuovo tipo `commands` in `protectedApps.ts`: Terminale, iTerm2, Warp, Alacritty, kitty, WezTerm, Hyper, Ghostty, Tabby, Script Editor, Automator, Comandi Rapidi, per nome e bundle id. I comandi passano da `run_command`.
- Test: `protectedApps.test.ts` ("the apps where typed text runs as a command"). Un test della PR #604 diceva che "Terminale" non era protetto: ora lo è, e il test è stato aggiornato in quel senso.

### 4. `run_command` dell'Operatore (gira fuori dal sandbox del provider)

- Come: i comandi dell'Operatore sono figli di Trama, e macOS dà loro i permessi di Accessibilità e Registrazione schermo di Trama. Un `osascript` con System Events, `cliclick`, uno script Python con Quartz, `open -a Trama`, `defaults write dev.trama.app`, un `kill -USR1` sul processo di Trama, oppure la scrittura del documento del progetto (`Projects/<hash>.json` nella cartella dati, con `siteConsents`, `appConsents`, `mandate`, approvazioni) arrivavano allo stesso risultato. Il test lo mostra su `main`: `osascript ... click button "Sì" ... process "Trama"` risultava "eseguito".
- Chiusa da due livelli:
  1. Un nuovo divieto fisso, `tramaControl` ("Controllo di Trama da parte di un agente"), in `app/src/main/core/tramaGuard.ts`, controllato prima della serratura dei segreti. Rifiuta: i programmi che guidano input o app (`osascript`, `cliclick`, `xdotool`, `ydotool`, `automator`, `shortcuts`), le parole di automazione (System Events, `CGEventPost`, `AXUIElement`, `pyautogui`), le porte di debug (`--remote-debugging-port`, `/json/version`, `connectOverCDP`), `ELECTRON_RUN_AS_NODE`, `open` di Trama o Electron, `defaults write` di Trama, `kill` o `killall` di Trama per nome o PID, `kill -USR1`, un debugger su Trama, `tccutil`, `launchctl`, `crontab`, `at`. Rifiuta anche ogni percorso nella cartella dati di Trama, nel profilo di Electron e nella cartella di installazione, letto come la serratura legge i segreti (`~` e `$HOME`, `cd`, percorsi relativi, glob, collegamenti, lettori ricorsivi di una cartella superiore). L'installazione non conta quando il progetto è il codice di Trama stesso. Il divieto non diventa una voce da approvare: nessuno lo sblocca, e `waitingForPerson` resta vuoto.
  2. Su macOS ogni comando dell'Operatore gira dentro `sandbox-exec` (`app/src/main/core/operatorSandbox.ts`). Il profilo permette tutto il resto (progetto, rete, strumenti) e nega: lettura, scrittura ed esecuzione nei dati e nell'installazione di Trama e nel database dei permessi di macOS (TCC); scrittura nei launch agent; Apple Events; il window server (niente clic o tasti sintetici, niente finestre); Launch Services (`open`); il vecchio canale `IOHIDParamUserClient`; l'esecuzione di `osascript`, `launchctl`, `open`, `tccutil`, `crontab`, `at`, `automator`, `shortcuts`. I percorsi passano come parametri (`-D`), mai scritti dentro le regole. Il profilo vale anche per i processi figli e per quelli lasciati in background. Se il profilo non parte, il comando non parte.
- Perché tutti e due: il controllo delle parole vale su ogni sistema ma si aggira con un testo nascosto (base64, uno script scaricato). Il sandbox vale per quello che il processo fa davvero, qualunque cosa dicano le parole, ma esiste solo su macOS. La serratura dei segreti da sola non bastava: legge solo le parole.
- Test: `selfApproval.integration.test.ts` ("a command of the Operator cannot drive Trama's window or write Trama's data": `osascript`, `cliclick`, scrittura e lettura nella cartella dati, `defaults write`; il runner non riceve nessun comando), `tramaGuard.test.ts` (parole, percorsi scritti in molti modi, comandi del progetto che restano liberi), `operatorSandbox.test.ts` (regole del profilo, parametri, avvio solo su macOS).

### 5. Il processo principale e le porte di debug

- Come: `kill -USR1 <pid di Trama>` apre l'inspector di Node sul processo principale (porta 9229); chi si collega chiama il controller e approva qualsiasi cosa. Verificato con Electron 44 in questo ambiente: senza difesa l'inspector si apre, con un listener di `SIGUSR1` resta chiuso. Lo stesso vale per un Trama riavviato con `--remote-debugging-port` o `--inspect`.
- Chiusa da: `app/src/main/main.ts` installa un listener di `SIGUSR1`; un Trama impacchettato con uno switch di debug o un inspector aperto esce subito (`debuggingRequested` in `tramaGuard.ts`). Sviluppo e ui-check restano come sono. Il riavvio da un comando è già bloccato dai punti 4.1 e 4.2.
- Test: `tramaGuard.test.ts` ("a packaged Trama never runs with a debugging port"); la prova su Electron è manuale e non è un test della suite.

### 6. Il Chrome dell'Operatore che in realtà è Trama

- Come: `open_in_chrome` e `send_data` parlano con la porta di debug 9222. Se a quella porta rispondeva Trama (da sviluppo, avviato con quella porta), l'Operatore apriva pagine dentro Trama.
- Chiusa da: prima di aprire una scheda il driver legge `/json/version` e rifiuta un programma che non è Chrome o che dice Electron o Trama (`isPersonChrome` in `operatorBrowser.ts`).
- Test: `operatorBrowser.test.ts` ("the Operator's Chrome is never Trama itself").

### 7. IPC del renderer

- Come: ogni azione IPC era accettata da qualsiasi frame e senza un gesto. Uno script nella pagina (per esempio codice iniettato dal server di sviluppo) poteva chiamare `window.trama.invoke("commandApproval:confirm", ...)`.
- Chiusa da: il processo principale accetta un'azione solo dalla finestra di Trama, dal frame principale e dalla pagina di Trama (il file `dist/index.html` o, in sviluppo, l'origine del server di Trama). Le azioni che danno un sì (`app/src/shared/personGesture.ts`: composer, passo successivo, Patto, risposte, mandato, sì ai comandi, consensi, azioni richieste, candidati, team, percorsi, piani, unione di squadre, presenza, accesso al computer acceso, proposte di memoria approvate) partono solo se il preload ha visto un clic o un tasto reale (`isTrusted`) negli ultimi 5 secondi. Il preload gira nel suo mondo isolato: la pagina non ne cambia l'orologio e un evento che uno script lancia non è mai reale. Rifiutare, ritirare e spegnere restano liberi.
- Test: `personGesture.test.ts` (elenco delle azioni, orologio del gesto, origine della pagina) e un passo di `ui-check` che chiama `pact:decide` da script senza gesto e verifica che Trama lo rifiuti e non registri nulla. Il resto dell'ui-check preme un tasto prima delle sue chiamate di sì, come farebbe la persona.

### 8. Consensi da frase e parole citate

- Come: un rapporto dell'Operatore, un output o una pagina incollati nel composer passavano dal lettore dei consensi. "Puoi usare l'app Finder" dentro un incollato lungo, una riga citata con `>` o un blocco di codice registravano un consenso. Le stesse parole valevano come citazione per `run_requested_action` e per la delega piena.
- Chiusa da: `app/src/shared/personWords.ts`. Del messaggio conta solo quello che la persona ha scritto: escono gli incollati lunghi (`<pasted_text>`), gli incollati corti di più parole (il composer li manda a parte), le righe citate e i blocchi di codice. Un indirizzo incollato dentro la frase della persona resta. Vale per i consensi e per `findPersonRequest`, quindi anche per la delega piena e le azioni richieste. I testi che arrivano da strumenti, pagine e output non passavano già dal lettore (issue #410).
- Test: `selfApproval.integration.test.ts` (ultimo test), `personWords.test.ts`, `personRequest.test.ts` ("only the person's own words ask"), `appConsents.integration.test.ts` ("never takes a consent from a text of the screen, a command or the model").

### 9. Strumenti del Coordinatore e degli specialisti

- Come verificato: nessuno strumento registra un consenso, concede il mandato o approva un comando. `grant_full_delegation` e `run_requested_action` cercano le parole in un messaggio scritto dalla persona nel composer: prima le trovavano anche in un testo incollato (punto 8). `decide_with_delegation` e `approve_with_delegation` registrano la scelta come del Coordinatore con la delega, mai come della persona, e senza delega rifiutano. Gli sviluppatori hanno solo `ask_coordinator`, `install_dependencies` e `align_with_base`.
- Test: `personApprovals.test.ts` chiama ogni strumento del Coordinatore con parole di consenso, di delega e di richiesta presenti solo in testi incollati, e verifica che consensi, mandato, delega, approvazioni e risposte del Patto restino vuoti. Senza la correzione del punto 8 il test fallisce (la delega veniva registrata).

### 10. Il Coordinatore che rimanda a una voce che non esiste

- Come: il rapporto dell'Operatore parlava di un consenso da chiedere; il Coordinatore diceva alla persona di approvarlo in "Aspetta te", dove non c'era niente.
- Chiusa da: PR #604 (`waitingForPerson` nella risposta di `ask_operator`, con le sole voci davvero create, e istruzioni al Coordinatore) e, in più, un controllo di Trama: dopo un turno con un ordine all'Operatore, se la risposta manda la persona ad "Aspetta te" per un sì e lì non c'è nessuna richiesta di consenso o di comando, la chat lo dice ("In Aspetta te non c'è niente da approvare").
- Test: `selfApproval.integration.test.ts` ("the Coordinator does not send the person to an Aspetta te where nothing waits", anche il caso con la voce vera), `coordinatorGrounding.test.ts`, `appConsents.integration.test.ts` (`waitingForPerson`).

## Cosa resta fuori, detto onestamente

- Un altro processo dell'utente non lanciato da Trama (un'app con il permesso di Accessibilità, uno script avviato dalla persona nel suo terminale) può ancora cliccare nella finestra di Trama. Un clic sintetico a livello di sistema arriva al renderer come un clic vero: Trama non lo distingue. La difesa è che nessun processo lanciato da Trama possa farlo.
- Il sandbox esiste solo su macOS. Su Linux e Windows vale solo il controllo delle parole del punto 4.1: un comando che nasconde il percorso (per esempio costruendolo con `printf`) può ancora leggere o scrivere i dati di Trama. Lo schermo dell'Operatore funziona solo su macOS.
- Il profilo `sandbox-exec` è stato provato dalla persona su un Mac reale (macOS, Darwin 25.5), con `sandboxedSpawn` di questo branch e una cartella dati finta (commento sulla PR #607): il profilo parte; girano `git`, `node`, `npm`, `curl` verso github.com, lettura e scrittura nel progetto dentro la cartella nascosta e Chromium di Playwright senza finestra; sono bloccati lettura e scrittura nella cartella dati nascosta, scrittura nella cartella in sola lettura, `osascript`, `open` e `launchctl`. 12 casi su 12 come previsto. Non è stato provato un clic sintetico verso il window server dentro il sandbox. Togliere il window server può fermare programmi del progetto che aprono una finestra (un'app Electron del progetto, un browser con finestra).
- Dentro il sandbox un processo può ancora chiedere a launchd un lavoro con le API di sistema (non con `launchctl`, che è bloccato). Un lavoro così girerebbe fuori dal sandbox. Non l'ho chiuso.
- Le app che hanno un terminale integrato (un editor di codice) non sono nell'elenco dei terminali: con il consenso per quell'app l'Operatore potrebbe scrivere nel suo terminale. Il controllo dell'app sotto il puntatore e in primo piano resta, ma non guarda quale pannello dell'app ha il fuoco.
- Il gesto della persona copre 5 secondi su tutta la finestra: uno script già dentro la pagina potrebbe aspettare un clic della persona e approvare subito dopo. Oggi la pagina non mostra HTML degli agenti e la CSP non permette script esterni; il caso resta per il server di sviluppo (`npm run dev`), dove chi modifica i sorgenti di Trama ne cambia la pagina.
- In sviluppo e nell'ui-check Trama accetta le porte di debug: servono a Playwright.
- I fusibili di Electron (`EnableNodeCliInspectArguments` spento) chiuderebbero l'inspector anche nel binario. Non li ho attivati perché cambiano il binario al momento del pacchetto e possono rompere la firma ad hoc su Apple Silicon senza una prova della release: è una proposta per la release.
- Gli agenti dei provider (Codex, Claude) lavorano nel loro sandbox con scrittura nel progetto; la lettura della cartella dati di Trama da parte loro dipende dal sandbox del provider e non è trattata qui.

## Controlli eseguiti

Elencati nella PR, con l'SHA di `origin/main` provato. Nessuna prova reale di Codex.
