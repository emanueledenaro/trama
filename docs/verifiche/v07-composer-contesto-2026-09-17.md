# V07: composer con menzioni e misuratore di contesto

Verifica del 17 settembre 2026 per #70. Base: `4b9916b` (V02). Candidato sul branch `synara/v07-composer-context-meter`. Componente reale: Codex CLI con l'account ChatGPT del Mac. Modello dei turni: `gpt-5.6-luna`.

## Test automatici

`swift test` sul candidato dopo le correzioni della prova: 200 test Swift Testing in 27 suite e 112 test XCTest, nessun fallimento. Le suite nuove coprono trigger del composer, menzioni, skill, testo incollato e allegati, finestra di contesto, soglia e override di modello e sforzo. La correzione su `gh` aggiunge un test che il processo parte senza colori ANSI.

## Ambiente della prova nell'app

L'app è stata compilata dal branch con un aggancio temporaneo, rimosso prima del commit. L'aggancio apriva il progetto, aspettava Codex, scriveva nel composer, inviava, regolava la soglia e catturava la finestra con `NSView.cacheDisplay`. Come in V01 e V02 la sessione non ha la registrazione dello schermo né l'accesso di assistenza. Nella cattura la barra laterale e i pulsanti in alto restano bianchi. Il testo della bolla della persona spesso non viene disegnato; il contenuto del messaggio è nel composer prima dell'invio e nella riga di attività.

Trama girava con `CFFIXED_USER_HOME=/tmp/trama-v07-home`. I dati reali in Application Support non sono stati né modificati né copiati. Il catalogo della home isolata registrava un clone del branch in `/tmp/trama-v07-proof/nomodel/trama`, con `origin` su `github.com/emanueledenaro/trama`. Il documento di quel clone partiva senza `selectedModel`.

`~/.codex/config.toml` non è stato modificato. Nei documenti copiati non c'era un modello salvato, salvo dopo la preselezione di Luna da parte di Trama.

## Esiti

1. Senza modello nel documento, Trama preseleziona `gpt-5.6-luna` invece del predefinito del catalogo (`gpt-6-astra` su questo account). L'attività riporta «Modello del Coordinatore preselezionato: gpt-5.6-luna.» Il selettore e l'intestazione mostrano GPT-5.6-Luna. [01](v07/01-luna-preselected.png)
2. Il Coordinatore apre il thread `01a0ac5f-f76d-72f1-a0bd-b202b92a00a3` con Luna. Lo studio arriva come scheda. Il composer è flottante, con angoli continui, riga inferiore (allegati, ambito, modello, sforzo, misuratore, invio). Dopo lo studio il misuratore mostra 4,1% (34.204 su 828.400 token). [02](v07/02-study-and-meter.png)
3. La soglia di avviso è stata portata all'1%. Compare la scheda «Contesto oltre la soglia»: 4,1% (34k su 828k), sopra l'1%. [03](v07/03-threshold-warning.png) Questo passo è stato ripetuto dopo aver alzato il minimo al 5% (vedi «Soglia minima al 5%»).
4. Nel composer: `@module:Sources/TramaCore` (chip) e `@issue:70`, sforzo «Alto · solo il prossimo». Le menzioni si risolvono su modulo TramaCore e issue #70. [04](v07/04-mentions-and-effort.png)
5. All'invio la riga di attività dice: `gpt-5.6-luna · sforzo alto solo per questo messaggio · aggiornamento: github, memoria · riferimenti: modulo TramaCore, issue #70`. [05](v07/05-mention-sent.png)
6. La risposta, in Luna, è: «Hai citato l'issue #70, dedicata al composer con menzioni e misuratore della finestra di contesto.» Il misuratore passa a 5,1% (41.921 token). [06](v07/06-mention-reply-meter.png)

Il clone senza modello è la prova della preselezione. Dopo quella preselezione il documento ha `selectedModel` = `gpt-5.6-luna`; i riavvii successivi riprendono lo stesso thread.

## Soglia minima al 5%

Un'opzione all'1% ha poco senso per chi usa Trama, quindi il minimo del prodotto è ora 5% e il selettore va da 5% a 95% di 5 in 5. Una soglia salvata sotto il minimo (l'1% di questa prova) viene letta come 5%. Il passo 3 è stato ripetuto lo stesso 17 settembre nella stessa home isolata (`CFFIXED_USER_HOME=/tmp/trama-v07-home`), con un aggancio temporaneo rimosso prima del commit, sul thread `01a0ac5f-f76d-72f1-a0bd-b202b92a00a3` con `selectedModel` = `gpt-5.6-luna`:

- all'avvio il documento aveva la soglia salvata all'1%; Trama l'ha letta come 5% e il misuratore mostrava 5,1% (41.921 su 828.400);
- l'aggancio ha impostato la soglia al 5% con `setContextThreshold(5)`;
- il documento ha registrato la scheda `contextNotice` «Contesto oltre la soglia»: «La finestra di contesto del Coordinatore è piena al 5,1% (42k su 828k token), sopra la soglia impostata del 5%.»

Nessun turno nuovo: il file del thread in `~/.codex/sessions` non è cambiato (ultima modifica 00:59) e non è partito nessun `turn/start`. `~/.codex/config.toml` ha lo stesso hash di prima. Application Support reale non è stato toccato. `lastProject` in `UserDefaults` è stato riportato al valore precedente.

La cattura di questo passaggio non è allegata. `cacheDisplay` ha disegnato il misuratore al 5,1% e la vecchia scheda all'1%, ma non la nuova scheda in fondo alla chat, neanche dopo lo scorrimento. La prova della scheda al 5% è l'evento nel documento.

## Build

`bash scripts/build-app.sh release` ha prodotto `build/Trama.app`.

## Modelli usati

| Thread | Uso | Turni |
| --- | --- | --- |
| `01a0ac5f-f76d-72f1-a0bd-b202b92a00a3` | studio, poi messaggio con menzioni e sforzo alto | 2 con `gpt-5.6-luna` |

Il catalogo dell'account includeva `gpt-6-astra` (predefinito Codex) e `gpt-5.6-luna`. Astra non è stato usato. Nessun probe ha chiamato `gpt-6-astra`.

## Limiti

- La finestra del modello in prova è 828.400 token. Lo studio occupa il 4,1%. La soglia minima è 5% (durante la prova è stata 1%, prima ancora 10% e 50%). Con il minimo al 5% l'avviso scatta su questa finestra solo dopo il secondo turno (5,1%). Il selettore va da 5% a 95% di 5 in 5. Il predefinito resta 80%.
- Il misuratore usa `last.totalTokens` dell'ultima richiesta, come Synara, non il cumulativo del thread. Dopo il secondo turno è salito da 34.204 a 41.921.
- La compattazione del provider non è apparsa in questa prova. Trama osserva `thread/compacting`, `thread/compacted` e gli elementi `contextCompaction` (`item/started`, `item/updated`, `item/completed`). Non la simula.
- Skill `/`, testo incollato e immagini sono coperti dai test e dal composer, non da un invio reale in questa prova. Non c'erano decisioni del Patto nel clone, quindi niente menzione di decisione nell'app.
- `CFFIXED_USER_HOME` non isola `UserDefaults`. Al primo avvio `lastProject` ha aperto anche `/tmp/trama-v02-proof/luna/trama`. Quel documento è nella home isolata, non in Application Support reale. Gli avvii successivi del driver saltavano `restoreProject`.
- `cacheDisplay` non disegna i materiali traslucidi né, in questa sessione, il testo nella bolla della persona. Il testo inviato è nella cattura del composer e nella riga di attività.
- `gh api` colorava il JSON (codici ANSI) e Trama lo rifiutava come risposta malformata: menzioni di issue e lo snapshot GitHub restavano vuoti. Il processo `gh` ora parte con `NO_COLOR=1`, `CLICOLOR=0`, `TERM=dumb` e `GH_PAGER=cat`.
- Le prove hanno creato un thread persistente in `~/.codex/sessions` dell'account.
